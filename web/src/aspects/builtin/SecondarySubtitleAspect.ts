import { PlayerAspect, AspectContext } from '../PlayerAspect';
import { AspectMetadata, AnchorSlot } from '../../engine/types';
import { SubtitleCue, SubtitleTrackInfo, SubtitleParser } from '../../player/SubtitleParser';

interface SecondarySubtitlePreferences {
    masterEnabled: boolean;
    selectedTrackIndex: number | null;
    position: 'top' | 'middle' | 'above-controls';
    fontSize: 'compact' | 'normal' | 'large';
    backgroundStyle: 'frosted-pill' | 'dark-box' | 'text-outline';
    offsetSeconds: number;
}

const STORAGE_KEY = 'playadapt_secondary_subtitle_pref';

/**
 * SecondarySubtitleAspect: Completely isolated secondary subtitle engine.
 * - Master Toggle: Defaults to OFF. When disabled, zero network requests,
 *   zero DOM elements, and zero timers are active.
 * - Primary Subtitle Isolation: Under NO circumstance does this touch or intercept
 *   the primary subtitle track or libass rendering pipeline.
 * - Pure Clear-Text Rendering: Strips all ASS typesetting, style overrides, and positioning,
 *   rendering pure legible text into a dedicated fixed-place container.
 */
export class SecondarySubtitleAspect implements PlayerAspect {
    public readonly metadata: AspectMetadata = {
        id: 'secondary-subtitle',
        name: 'Dual Subtitles (Secondary Track)',
        description: 'Isolated secondary subtitle track for language learning with pure clear text and zero primary subtitle interference.',
        category: 'subtitles',
        defaultEnabled: true,
        defaultSlot: AnchorSlot.AfterSubtitles
    };

    private button: HTMLButtonElement | null = null;
    private unmountButton: (() => void) | null = null;
    private subContainer: HTMLElement | null = null;
    private unmountSubContainer: (() => void) | null = null;
    private syncTimer: any = null;
    private currentCues: SubtitleCue[] = [];
    private activeCueText: string = '';
    private prefs: SecondarySubtitlePreferences;
    private menuHandle: { element: HTMLElement; open: () => void; close: () => void } | null = null;

    private eventsBound: boolean = false;

    constructor() {
        this.prefs = this.loadPreferences();
    }

    public init(context: AspectContext): void {
        this.bindPlayerEvents(context);
        this.render(context);
    }

    public onPlayerMount(context: AspectContext): void {
        this.bindPlayerEvents(context);
        this.render(context);
    }

    public onPlayerUnmount(): void {
        this.cleanup();
    }

    public onConfigChange(_newOptions: Record<string, any>): void {
        // No-op
    }

    public destroy(): void {
        this.cleanup();
    }

    private bindPlayerEvents(context: AspectContext): void {
        if (this.eventsBound) return;
        this.eventsBound = true;

        const onMediaUpdate = () => {
            if (!this.prefs.masterEnabled) return;

            const tracks = context.player.getSubtitleTracks();
            const primaryIdx = context.player.getPrimarySubtitleIndex();

            // If selected track doesn't exist on this media, auto-resolve
            let targetTrack = tracks.find(t => t.index === this.prefs.selectedTrackIndex);
            if (!targetTrack && tracks.length > 0) {
                targetTrack = tracks.find(t => t.index !== primaryIdx) || tracks[0];
                this.prefs.selectedTrackIndex = targetTrack.index;
                this.savePreferences();
            }

            if (targetTrack) {
                this.mountSubtitleDisplay(context);
                this.loadTrackCues(context, targetTrack.index);
            }
        };

        context.player.on('playbackstart', onMediaUpdate);
        context.player.on('mediastreamschange', onMediaUpdate);
        context.player.on('playbackstop', () => {
            this.teardownSubtitleDisplay();
        });
    }

    private loadPreferences(): SecondarySubtitlePreferences {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    masterEnabled: parsed.masterEnabled === true,
                    selectedTrackIndex: typeof parsed.selectedTrackIndex === 'number' ? parsed.selectedTrackIndex : null,
                    position: parsed.position || 'top',
                    fontSize: parsed.fontSize || 'normal',
                    backgroundStyle: parsed.backgroundStyle || 'frosted-pill',
                    offsetSeconds: typeof parsed.offsetSeconds === 'number' ? parsed.offsetSeconds : 0
                };
            }
        } catch (e) {
            // Ignore parse errors
        }

        return {
            masterEnabled: false, // Default is strictly OFF
            selectedTrackIndex: null,
            position: 'top',
            fontSize: 'normal',
            backgroundStyle: 'frosted-pill',
            offsetSeconds: 0
        };
    }

    private savePreferences(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
        } catch (e) {
            // Ignore storage quota
        }
    }

    private render(context: AspectContext): void {
        this.cleanup();

        // 1. Create themed toolbar button for secondary subtitle access
        // Distinct translate icon and '2' badge immediately after primary subtitle button
        this.button = context.factory.createThemedButton({
            id: 'playadapt-btn-secondary-sub',
            icon: 'translate',
            badge: '2',
            tooltip: 'Secondary Subtitle (Dual Subs)',
            active: this.prefs.masterEnabled,
            onClick: () => {
                this.openMenu(context);
            }
        });

        if (this.prefs.masterEnabled) {
            this.button.classList.add('playadapt-btn-active');
        }

        const slot = context.slotOverride || this.metadata.defaultSlot || AnchorSlot.AfterSubtitles;
        this.unmountButton = context.layout.attachToSlot({
            slot,
            element: this.button
        });

        // 2. Strict Master Toggle Check:
        // If master toggle is not enabled, STAY AWAY COMPLETELY.
        if (!this.prefs.masterEnabled) {
            return;
        }

        const availableTracks = context.player.getSubtitleTracks();
        const primaryIdx = context.player.getPrimarySubtitleIndex();

        // Auto-select valid track if none selected or if previous index is invalid for current media
        if ((this.prefs.selectedTrackIndex === null || !availableTracks.some(t => t.index === this.prefs.selectedTrackIndex)) && availableTracks.length > 0) {
            const candidate = availableTracks.find(t => t.index !== primaryIdx) || availableTracks[0];
            this.prefs.selectedTrackIndex = candidate.index;
            this.savePreferences();
        }

        if (this.prefs.selectedTrackIndex === null) {
            return;
        }

        // 3. Mount isolated secondary subtitle display container
        this.mountSubtitleDisplay(context);

        // 4. Fetch cues and start sync loop
        this.loadTrackCues(context, this.prefs.selectedTrackIndex);
    }

    private mountSubtitleDisplay(context: AspectContext): void {
        if (this.subContainer) {
            if (this.unmountSubContainer) this.unmountSubContainer();
            this.subContainer = null;
        }

        this.subContainer = document.createElement('div');
        this.subContainer.id = 'playadapt-secondary-sub-container';
        this.subContainer.className = `playadapt-secondary-sub playadapt-sub-pos-${this.prefs.position} playadapt-sub-size-${this.prefs.fontSize} playadapt-sub-style-${this.prefs.backgroundStyle}`;
        this.subContainer.style.display = 'none';

        // Always attach to isolated top-center slot or overlay
        const slot = this.prefs.position === 'top'
            ? AnchorSlot.OsdOverlayTopCenter
            : AnchorSlot.OsdOverlayBottom;

        this.unmountSubContainer = context.layout.attachToSlot({
            slot,
            element: this.subContainer
        });
    }

    private async loadTrackCues(context: AspectContext, trackIndex: number): Promise<void> {
        this.currentCues = [];
        this.activeCueText = '';
        if (this.subContainer) {
            this.subContainer.textContent = '';
            this.subContainer.style.display = 'none';
        }

        const cues = await context.player.fetchSubtitleCues(trackIndex);
        this.currentCues = cues;

        if (this.currentCues.length > 0) {
            this.startSyncLoop(context);
        }
    }

    private startSyncLoop(context: AspectContext): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }

        this.syncTimer = setInterval(() => {
            if (!this.prefs.masterEnabled || !this.subContainer || this.currentCues.length === 0) {
                return;
            }

            const currentTime = context.player.getCurrentTime();
            const active = SubtitleParser.getActiveCues(this.currentCues, currentTime, this.prefs.offsetSeconds);

            if (active.length > 0) {
                const combinedText = active.map(c => c.text).join('\n');
                if (combinedText !== this.activeCueText) {
                    this.activeCueText = combinedText;
                    this.subContainer.textContent = combinedText;
                    this.subContainer.style.display = 'block';
                }
            } else {
                if (this.activeCueText !== '') {
                    this.activeCueText = '';
                    this.subContainer.textContent = '';
                    this.subContainer.style.display = 'none';
                }
            }
        }, 150);
    }

    private openMenu(context: AspectContext): void {
        if (this.menuHandle) {
            this.menuHandle.close();
            this.menuHandle = null;
        }

        const availableTracks = context.player.getSubtitleTracks();
        const primaryIdx = context.player.getPrimarySubtitleIndex();

        this.menuHandle = context.factory.createThemedMenu({
            id: 'playadapt-secondary-sub-menu',
            title: 'Secondary Subtitle (Dual Subs)',
            items: () => {
                const items: any[] = [
                    {
                        id: 'master_toggle',
                        label: this.prefs.masterEnabled ? 'Master Toggle: Enabled' : 'Master Toggle: Disabled',
                        icon: this.prefs.masterEnabled ? 'toggle_on' : 'toggle_off',
                        selected: this.prefs.masterEnabled,
                        badge: this.prefs.masterEnabled ? 'ON' : 'OFF',
                        onClick: () => {
                            this.prefs.masterEnabled = !this.prefs.masterEnabled;
                            this.savePreferences();

                            if (this.button) {
                                if (this.prefs.masterEnabled) {
                                    this.button.classList.add('playadapt-btn-active');
                                } else {
                                    this.button.classList.remove('playadapt-btn-active');
                                }
                            }

                            if (!this.prefs.masterEnabled) {
                                // Instantly tear down all secondary subtitle DOM and timers
                                this.teardownSubtitleDisplay();
                            } else {
                                // Auto-select first non-primary track if none selected
                                if (this.prefs.selectedTrackIndex === null && availableTracks.length > 0) {
                                    const candidate = availableTracks.find(t => t.index !== primaryIdx) || availableTracks[0];
                                    this.prefs.selectedTrackIndex = candidate.index;
                                    this.savePreferences();
                                }
                                this.mountSubtitleDisplay(context);
                                if (this.prefs.selectedTrackIndex !== null) {
                                    this.loadTrackCues(context, this.prefs.selectedTrackIndex);
                                }
                            }
                            context.factory.showToast(this.prefs.masterEnabled ? '🔤 Secondary Subtitles Enabled' : 'Secondary Subtitles Disabled');
                        }
                    }
                ];

                // If master toggle is enabled, provide track picker and appearance settings
                if (this.prefs.masterEnabled) {
                    // Track Picker
                    availableTracks.forEach((t: SubtitleTrackInfo) => {
                        const isPrimary = t.index === primaryIdx;
                        const isSelected = t.index === this.prefs.selectedTrackIndex;
                        const badge = isPrimary ? 'Primary' : isSelected ? 'Secondary' : undefined;

                        items.push({
                            id: `track_${t.index}`,
                            label: t.title,
                            icon: isSelected ? 'check_circle' : 'subtitles',
                            selected: isSelected,
                            badge,
                            onClick: () => {
                                this.prefs.selectedTrackIndex = t.index;
                                this.savePreferences();
                                this.loadTrackCues(context, t.index);
                                context.factory.showToast(`Secondary Subtitle: ${t.title}`);
                            }
                        });
                    });

                    // Position setting
                    items.push({
                        id: 'cycle_position',
                        label: `Position: ${this.prefs.position === 'top' ? 'Top Center' : this.prefs.position === 'middle' ? 'Middle' : 'Above Controls'}`,
                        icon: 'vertical_align_top',
                        badge: 'Switch',
                        onClick: () => {
                            if (this.prefs.position === 'top') this.prefs.position = 'middle';
                            else if (this.prefs.position === 'middle') this.prefs.position = 'above-controls';
                            else this.prefs.position = 'top';

                            this.savePreferences();
                            if (this.subContainer) {
                                this.subContainer.className = `playadapt-secondary-sub playadapt-sub-pos-${this.prefs.position} playadapt-sub-size-${this.prefs.fontSize} playadapt-sub-style-${this.prefs.backgroundStyle}`;
                            }
                        }
                    });

                    // Size setting
                    items.push({
                        id: 'cycle_size',
                        label: `Font Size: ${this.prefs.fontSize === 'normal' ? 'Normal' : this.prefs.fontSize === 'large' ? 'Large' : 'Compact'}`,
                        icon: 'format_size',
                        badge: 'Switch',
                        onClick: () => {
                            if (this.prefs.fontSize === 'normal') this.prefs.fontSize = 'large';
                            else if (this.prefs.fontSize === 'large') this.prefs.fontSize = 'compact';
                            else this.prefs.fontSize = 'normal';

                            this.savePreferences();
                            if (this.subContainer) {
                                this.subContainer.className = `playadapt-secondary-sub playadapt-sub-pos-${this.prefs.position} playadapt-sub-size-${this.prefs.fontSize} playadapt-sub-style-${this.prefs.backgroundStyle}`;
                            }
                        }
                    });

                    // Style setting
                    items.push({
                        id: 'cycle_style',
                        label: `Style: ${this.prefs.backgroundStyle === 'frosted-pill' ? 'Frosted Glass' : this.prefs.backgroundStyle === 'dark-box' ? 'Solid Dark' : 'Text Outline'}`,
                        icon: 'palette',
                        badge: 'Switch',
                        onClick: () => {
                            if (this.prefs.backgroundStyle === 'frosted-pill') this.prefs.backgroundStyle = 'dark-box';
                            else if (this.prefs.backgroundStyle === 'dark-box') this.prefs.backgroundStyle = 'text-outline';
                            else this.prefs.backgroundStyle = 'frosted-pill';

                            this.savePreferences();
                            if (this.subContainer) {
                                this.subContainer.className = `playadapt-secondary-sub playadapt-sub-pos-${this.prefs.position} playadapt-sub-size-${this.prefs.fontSize} playadapt-sub-style-${this.prefs.backgroundStyle}`;
                            }
                        }
                    });
                }

                return items;
            },
            anchorElement: this.button || undefined
        });

        this.menuHandle.open();
    }

    private teardownSubtitleDisplay(): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
        if (this.unmountSubContainer) {
            this.unmountSubContainer();
            this.unmountSubContainer = null;
        }
        this.subContainer = null;
        this.currentCues = [];
        this.activeCueText = '';
    }

    private cleanup(): void {
        this.teardownSubtitleDisplay();
        if (this.unmountButton) {
            this.unmountButton();
            this.unmountButton = null;
        }
        if (this.menuHandle) {
            if (this.menuHandle.element.parentElement) {
                this.menuHandle.element.parentElement.removeChild(this.menuHandle.element);
            }
            this.menuHandle = null;
        }
        this.button = null;
    }
}
