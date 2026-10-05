import { PlayerAspect, AspectContext } from '../PlayerAspect';
import { AspectMetadata, AnchorSlot } from '../../engine/types';
import { DetailedMediaInfo } from '../../player/PlayerController';

interface UserPreferences {
    showBitrate: boolean;
    showCodec: boolean;
    showHdr: boolean;
    showAudio: boolean;
    showPlaybackMethod: boolean;
    style: 'glass-pills' | 'glow-badges' | 'compact-minimal';
    bitrateUnit: 'Mbps' | 'MB/s' | 'Kbps';
    positionOverride?: string;
}

const STORAGE_KEY = 'playadapt_media_tags_user_pref';

/**
 * MediaInfoTagsAspect: Displays adaptive floating tags showing video codec,
 * resolution, special video flags (Dolby Vision, HDR10+, HLG, BT.2020), audio
 * channels, and realtime bitrate. Provides session/user-specific preferences
 * inside the player and admin restrictions in the dashboard.
 */
export class MediaInfoTagsAspect implements PlayerAspect {
    public readonly metadata: AspectMetadata = {
        id: 'media-info-tags',
        name: 'Codec & Realtime Bitrate Floating Tags',
        description: 'Displays adaptive floating tags showing video codec, HDR/Dolby Vision flags, audio channels, and live bitrate.',
        category: 'information',
        defaultEnabled: true,
        defaultSlot: AnchorSlot.OsdOverlayTopLeft
    };

    private dockContainer: HTMLElement | null = null;
    private unmountSlot: (() => void) | null = null;
    private refreshTimer: any = null;
    private userPrefs: UserPreferences;
    private currentContext: AspectContext | null = null;
    private menuHandle: { element: HTMLElement; open: () => void; close: () => void } | null = null;

    constructor() {
        this.userPrefs = this.loadUserPreferences();
    }

    public init(context: AspectContext): void {
        this.currentContext = context;
        this.render(context);
    }

    public onPlayerMount(context: AspectContext): void {
        this.currentContext = context;
        this.render(context);
    }

    public onPlayerUnmount(): void {
        this.cleanup();
    }

    public onConfigChange(_newOptions: Record<string, any>): void {
        if (this.currentContext) {
            this.render(this.currentContext);
        }
    }

    public destroy(): void {
        this.cleanup();
    }

    private loadUserPreferences(): UserPreferences {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (e) {
            // Ignore parse errors
        }

        return {
            showBitrate: true,
            showCodec: true,
            showHdr: true,
            showAudio: true,
            showPlaybackMethod: true,
            style: 'glass-pills',
            bitrateUnit: 'Mbps'
        };
    }

    private saveUserPreferences(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userPrefs));
        } catch (e) {
            // Ignore storage quota
        }
    }

    private render(context: AspectContext): void {
        this.cleanup();

        // 1. Create Floating Tags Dock Container
        this.dockContainer = document.createElement('div');
        this.dockContainer.id = 'playadapt-media-tags-dock';
        this.dockContainer.className = `playadapt-tags-dock playadapt-sync-osd playadapt-style-${this.userPrefs.style}`;
        this.dockContainer.setAttribute('title', 'Click to configure tags & bitrate display');

        // Clicking anywhere on the dock or settings icon opens session preferences
        this.dockContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openSessionSettingsMenu(context);
        });

        // 2. Resolve Anchor Slot
        const slot = this.resolveActiveSlot(context);
        this.unmountSlot = context.layout.attachToSlot({
            slot,
            element: this.dockContainer
        });

        // 3. Initial Populate
        this.updateTags(context);

        // 4. Start polling for realtime bitrate & stream state
        const intervalMs = context.options.bitrateIntervalMs || 1000;
        this.refreshTimer = setInterval(() => {
            if (this.dockContainer) {
                this.updateTags(context);
            }
        }, intervalMs);
    }

    private resolveActiveSlot(context: AspectContext): AnchorSlot | string {
        const prefPos = this.userPrefs.positionOverride;
        if (prefPos === 'TopRight') return AnchorSlot.OsdOverlayTopRight;
        if (prefPos === 'TopLeft') return AnchorSlot.OsdOverlayTopLeft;
        if (prefPos === 'BottomMediaInfo') return AnchorSlot.SecondaryMediaInfo;

        const adminSlot = context.slotOverride || context.options.position;
        if (adminSlot === 'TopRight') return AnchorSlot.OsdOverlayTopRight;
        if (adminSlot === 'BottomMediaInfo') return AnchorSlot.SecondaryMediaInfo;
        return AnchorSlot.OsdOverlayTopLeft;
    }

    private updateTags(context: AspectContext): void {
        if (!this.dockContainer) return;

        const info: DetailedMediaInfo = context.player.getDetailedMediaInfo();
        const htmlParts: string[] = [];

        // A. Video Codec & Resolution Tag
        if (this.userPrefs.showCodec && (context.options.showCodec !== false)) {
            let codecLabel = info.videoCodec;
            if (info.resolutionText) {
                codecLabel += ` · ${info.resolutionText}`;
            }
            if (info.bitDepthText) {
                codecLabel += ` · ${info.bitDepthText}`;
            }

            htmlParts.push(`
                <span class="playadapt-tag playadapt-tag-codec">
                    <span class="material-icons playadapt-tag-icon">movie</span>
                    <span class="playadapt-tag-text">${codecLabel}</span>
                </span>
            `);
        }

        // B. HDR & Special Video Flags Tag
        if (this.userPrefs.showHdr && (context.options.showHdr !== false) && info.isHdr) {
            info.hdrFlags.forEach(flag => {
                const isDovi = flag.includes('Dolby Vision') || flag.includes('DOVI');
                const isHdr10Plus = flag.includes('HDR10+');
                const badgeClass = isDovi ? 'playadapt-tag-dovi' : isHdr10Plus ? 'playadapt-tag-hdr10plus' : 'playadapt-tag-hdr';
                const label = isDovi && info.doviTitle ? info.doviTitle : flag;

                htmlParts.push(`
                    <span class="playadapt-tag ${badgeClass}">
                        <span class="playadapt-tag-badge">${isDovi ? 'DV' : 'HDR'}</span>
                        <span class="playadapt-tag-text">${label}</span>
                    </span>
                `);
            });

            if (info.colorSpace) {
                htmlParts.push(`
                    <span class="playadapt-tag playadapt-tag-colorspace">
                        <span class="playadapt-tag-text">${info.colorSpace}</span>
                    </span>
                `);
            }
        }

        // C. Audio Codec & Channels Tag
        if (this.userPrefs.showAudio && (context.options.showAudio !== false) && info.audioCodec) {
            let audioLabel = info.audioCodec;
            if (info.audioProfile) {
                audioLabel = `${info.audioCodec} (${info.audioProfile})`;
            }
            if (info.audioChannelsText) {
                audioLabel += ` · ${info.audioChannelsText}`;
            }

            htmlParts.push(`
                <span class="playadapt-tag playadapt-tag-audio">
                    <span class="material-icons playadapt-tag-icon">audiotrack</span>
                    <span class="playadapt-tag-text">${audioLabel}</span>
                </span>
            `);
        }

        // D. Playback Method Tag (Direct Play / Direct Stream / Transcode)
        if (this.userPrefs.showPlaybackMethod && (context.options.showPlaybackMethod !== false)) {
            let methodClass = 'playadapt-tag-directplay';
            let label: string = info.playbackMethod;
            let tooltip = '';

            if (info.playbackMethod === 'Direct Stream') {
                methodClass = 'playadapt-tag-directstream';
            } else if (info.playbackMethod === 'Transcode') {
                methodClass = 'playadapt-tag-transcode';
                if (info.transcodeReason && context.options.allowTranscodeDetailsNonAdmin !== false) {
                    tooltip = `Transcode: ${info.transcodeReason}`;
                    if (info.hardwareAcceleration) {
                        tooltip += ` (${info.hardwareAcceleration})`;
                    }
                    label = `Transcode · ${info.hardwareAcceleration || 'Software'}`;
                }
            }

            htmlParts.push(`
                <span class="playadapt-tag ${methodClass}" ${tooltip ? `title="${tooltip}"` : ''}>
                    <span class="playadapt-dot"></span>
                    <span class="playadapt-tag-text">${label}</span>
                </span>
            `);
        }

        // E. Realtime Bitrate Tag
        if (this.userPrefs.showBitrate && (context.options.showBitrate !== false)) {
            const formatted = context.player.formatBitrate(info.realtimeBitrateBps, this.userPrefs.bitrateUnit);
            htmlParts.push(`
                <span class="playadapt-tag playadapt-tag-bitrate">
                    <span class="playadapt-bitrate-pulse"></span>
                    <span class="playadapt-tag-text">${formatted}</span>
                </span>
            `);
        }

        // Add subtle settings trigger button at the end of the dock
        htmlParts.push(`
            <button type="button" class="playadapt-dock-settings-btn" title="Configure floating tags" aria-label="Configure floating tags">
                <span class="material-icons" style="font-size: 14px; opacity: 0.7;">tune</span>
            </button>
        `);

        this.dockContainer.innerHTML = htmlParts.join('');
    }

    /**
     * Session/User-specific settings menu displayed right inside the player viewport.
     */
    private openSessionSettingsMenu(context: AspectContext): void {
        if (this.menuHandle) {
            this.menuHandle.close();
            this.menuHandle = null;
        }

        this.menuHandle = context.factory.createThemedMenu({
            id: 'playadapt-media-tags-menu',
            title: 'Media Tags Preferences',
            items: () => [
                {
                    id: 'toggle_bitrate',
                    label: 'Realtime Bitrate Tag',
                    icon: 'speed',
                    selected: this.userPrefs.showBitrate,
                    onClick: () => {
                        this.userPrefs.showBitrate = !this.userPrefs.showBitrate;
                        this.saveUserPreferences();
                        this.updateTags(context);
                    }
                },
                {
                    id: 'toggle_codec',
                    label: 'Video Codec & Resolution',
                    icon: 'movie',
                    selected: this.userPrefs.showCodec,
                    onClick: () => {
                        this.userPrefs.showCodec = !this.userPrefs.showCodec;
                        this.saveUserPreferences();
                        this.updateTags(context);
                    }
                },
                {
                    id: 'toggle_hdr',
                    label: 'HDR & Special Flags',
                    icon: 'hdr_on',
                    selected: this.userPrefs.showHdr,
                    onClick: () => {
                        this.userPrefs.showHdr = !this.userPrefs.showHdr;
                        this.saveUserPreferences();
                        this.updateTags(context);
                    }
                },
                {
                    id: 'toggle_audio',
                    label: 'Audio Codec & Channels',
                    icon: 'audiotrack',
                    selected: this.userPrefs.showAudio,
                    onClick: () => {
                        this.userPrefs.showAudio = !this.userPrefs.showAudio;
                        this.saveUserPreferences();
                        this.updateTags(context);
                    }
                },
                {
                    id: 'toggle_method',
                    label: 'Playback Method (Direct/Transcode)',
                    icon: 'stream',
                    selected: this.userPrefs.showPlaybackMethod,
                    onClick: () => {
                        this.userPrefs.showPlaybackMethod = !this.userPrefs.showPlaybackMethod;
                        this.saveUserPreferences();
                        this.updateTags(context);
                    }
                },
                {
                    id: 'style_cycle',
                    label: `Style: ${this.userPrefs.style === 'glass-pills' ? 'Frosted Glass Pills' : this.userPrefs.style === 'glow-badges' ? 'Glowing Badges' : 'Compact Minimal'}`,
                    icon: 'palette',
                    badge: 'Switch',
                    onClick: () => {
                        if (this.userPrefs.style === 'glass-pills') {
                            this.userPrefs.style = 'glow-badges';
                        } else if (this.userPrefs.style === 'glow-badges') {
                            this.userPrefs.style = 'compact-minimal';
                        } else {
                            this.userPrefs.style = 'glass-pills';
                        }
                        this.saveUserPreferences();
                        if (this.dockContainer) {
                            this.dockContainer.className = `playadapt-tags-dock playadapt-sync-osd playadapt-style-${this.userPrefs.style}`;
                        }
                        this.updateTags(context);
                    }
                },
                {
                    id: 'unit_cycle',
                    label: `Bitrate Unit: ${this.userPrefs.bitrateUnit}`,
                    icon: 'straighten',
                    badge: 'Switch',
                    onClick: () => {
                        if (this.userPrefs.bitrateUnit === 'Mbps') {
                            this.userPrefs.bitrateUnit = 'MB/s';
                        } else if (this.userPrefs.bitrateUnit === 'MB/s') {
                            this.userPrefs.bitrateUnit = 'Kbps';
                        } else {
                            this.userPrefs.bitrateUnit = 'Mbps';
                        }
                        this.saveUserPreferences();
                        this.updateTags(context);
                    }
                }
            ],
            anchorElement: this.dockContainer || undefined
        });

        this.menuHandle.open();
    }

    private cleanup(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        if (this.unmountSlot) {
            this.unmountSlot();
            this.unmountSlot = null;
        }
        if (this.menuHandle) {
            if (this.menuHandle.element.parentElement) {
                this.menuHandle.element.parentElement.removeChild(this.menuHandle.element);
            }
            this.menuHandle = null;
        }
        this.dockContainer = null;
    }
}
