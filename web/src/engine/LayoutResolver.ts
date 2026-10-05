import { AnchorSlot, SlotAttachmentOptions } from './types';

/**
 * LayoutResolver: Intelligently resolves spatial layout anchor points inside Jellyfin's
 * official video player regardless of what theme is installed (Abyss, UltraChromic,
 * JellyFlix, Stock, or Custom CSS).
 */
export class LayoutResolver {
    private static instance: LayoutResolver;
    private activeAttachments: Map<string, { element: HTMLElement; container: HTMLElement }> = new Map();
    private isPlayerMounted: boolean = false;
    private playerObserver: MutationObserver | null = null;
    private osdVisible: boolean = true;
    private mountListeners: Array<(isMounted: boolean) => void> = [];

    private constructor() {}

    public static getInstance(): LayoutResolver {
        if (!LayoutResolver.instance) {
            LayoutResolver.instance = new LayoutResolver();
        }
        return LayoutResolver.instance;
    }

    public init(): void {
        this.startObservingPlayer();
    }

    public isMounted(): boolean {
        return this.isPlayerMounted;
    }

    public onMountChange(callback: (isMounted: boolean) => void): () => void {
        this.listenersPush(callback);
        return () => {
            this.mountListeners = this.mountListeners.filter(cb => cb !== callback);
        };
    }

    private listenersPush(cb: (isMounted: boolean) => void) {
        this.mountListeners.push(cb);
    }

    /**
     * Finds the root video OSD page or container.
     */
    public getPlayerRoot(): HTMLElement | null {
        return (
            document.querySelector('#videoOsdPage') as HTMLElement ||
            document.querySelector('.videoOsdPage') as HTMLElement ||
            document.querySelector('[data-role="page"].videoOsdPage') as HTMLElement ||
            document.querySelector('.viewManagerPage-video-osd') as HTMLElement ||
            document.querySelector('.videoOsdBottom')?.closest('.page') as HTMLElement ||
            null
        );
    }

    /**
     * Attaches an element to a semantic anchor slot in the player.
     * Returns an unmount callback.
     */
    public attachToSlot(options: SlotAttachmentOptions): () => void {
        const { slot, element, order = 0 } = options;
        const attachmentKey = `${slot}_${element.id || Math.random().toString(36).substring(2, 9)}`;

        const mount = () => {
            const container = this.resolveContainer(slot);
            if (!container) return false;

            element.classList.add('playadapt-injected-item');
            element.setAttribute('data-playadapt-slot', slot);

            // Determine optimal insertion target and position
            this.insertIntoSlot(container, slot, element, order);
            this.activeAttachments.set(attachmentKey, { element, container });
            return true;
        };

        if (!mount()) {
            // If player is not yet rendered, retry once player DOM becomes active
            const retryInterval = setInterval(() => {
                if (mount()) {
                    clearInterval(retryInterval);
                }
            }, 300);

            setTimeout(() => clearInterval(retryInterval), 5000);
        }

        return () => {
            if (element.parentElement) {
                element.parentElement.removeChild(element);
            }
            this.activeAttachments.delete(attachmentKey);
        };
    }

    private resolveContainer(slot: AnchorSlot | string): HTMLElement | null {
        const root = this.getPlayerRoot() || document.body;

        switch (slot) {
            case AnchorSlot.PlaybackControlsLeft:
            case AnchorSlot.PlaybackControlsRight:
            case AnchorSlot.SecondaryControlsStart:
            case AnchorSlot.SecondaryControlsEnd:
                return (
                    root.querySelector('.videoOsdBottom .buttons') as HTMLElement ||
                    root.querySelector('.osdControls .buttons') as HTMLElement ||
                    root.querySelector('.buttons') as HTMLElement ||
                    null
                );

            case AnchorSlot.TimelinePrefix:
            case AnchorSlot.TimelineSuffix:
                return (
                    root.querySelector('.sliderContainer')?.parentElement as HTMLElement ||
                    root.querySelector('.osdControls .sliderContainer') as HTMLElement ||
                    null
                );

            case AnchorSlot.TimelineAbove:
                return (
                    root.querySelector('.sliderContainer') as HTMLElement ||
                    null
                );

            case AnchorSlot.HeaderLeft:
            case AnchorSlot.HeaderRight:
            case AnchorSlot.HeaderActions:
                return (
                    root.querySelector('.osdHeader') as HTMLElement ||
                    root.querySelector('.skinHeader') as HTMLElement ||
                    root.querySelector('header.MuiAppBar-root') as HTMLElement ||
                    root.querySelector('.headerRight') as HTMLElement ||
                    null
                );

            case AnchorSlot.SecondaryMediaInfo:
                return (
                    root.querySelector('.osdSecondaryMediaInfo') as HTMLElement ||
                    root.querySelector('.osdMainTextContainer') as HTMLElement ||
                    root.querySelector('.osdTextContainer') as HTMLElement ||
                    null
                );

            case AnchorSlot.OsdOverlayTopLeft:
            case AnchorSlot.OsdOverlayTopRight:
            case AnchorSlot.OsdOverlayTopCenter:
            case AnchorSlot.OsdOverlayBottom:
            case AnchorSlot.VideoViewport:
                return (
                    root.querySelector('.videoOsdBottom')?.parentElement as HTMLElement ||
                    root ||
                    document.body
                );

            default:
                return root.querySelector('.buttons') as HTMLElement || root;
        }
    }

    private insertIntoSlot(container: HTMLElement, slot: AnchorSlot | string, element: HTMLElement, _order: number): void {
        switch (slot) {
            case AnchorSlot.PlaybackControlsLeft: {
                // Place near rewind or play
                const ref = container.querySelector('.btnRewind, .btnPreviousChapter, .btnPreviousTrack');
                if (ref && ref.parentElement === container) {
                    container.insertBefore(element, ref);
                } else {
                    container.insertBefore(element, container.firstChild);
                }
                break;
            }

            case AnchorSlot.PlaybackControlsRight: {
                // Place right after pause or fast forward
                const ref = container.querySelector('.btnFastForward, .btnNextChapter, .btnPause');
                if (ref && ref.nextSibling) {
                    container.insertBefore(element, ref.nextSibling);
                } else {
                    container.appendChild(element);
                }
                break;
            }

            case AnchorSlot.SecondaryControlsStart: {
                // Place before subtitles / audio / volume
                const ref = container.querySelector('.btnSubtitles, .btnAudio, .volumeButtons, .btnUserRating');
                if (ref) {
                    container.insertBefore(element, ref);
                } else {
                    container.appendChild(element);
                }
                break;
            }

            case AnchorSlot.SecondaryControlsEnd: {
                // Place right before settings or fullscreen
                const ref = container.querySelector('.btnVideoOsdSettings, .btnFullscreen, .btnPip');
                if (ref) {
                    container.insertBefore(element, ref);
                } else {
                    container.appendChild(element);
                }
                break;
            }

            case AnchorSlot.TimelinePrefix: {
                const startTime = container.querySelector('.startTimeText, .osdPositionText');
                if (startTime && startTime.nextSibling) {
                    container.insertBefore(element, startTime.nextSibling);
                } else {
                    container.insertBefore(element, container.firstChild);
                }
                break;
            }

            case AnchorSlot.TimelineSuffix: {
                const endTime = container.querySelector('.endTimeText, .osdDurationText');
                if (endTime) {
                    container.insertBefore(element, endTime);
                } else {
                    container.appendChild(element);
                }
                break;
            }

            case AnchorSlot.OsdOverlayTopRight: {
                this.styleAsOverlay(element, 'top-right');
                container.appendChild(element);
                break;
            }

            case AnchorSlot.OsdOverlayTopLeft: {
                this.styleAsOverlay(element, 'top-left');
                container.appendChild(element);
                break;
            }

            case AnchorSlot.OsdOverlayTopCenter: {
                this.styleAsOverlay(element, 'top-center');
                container.appendChild(element);
                break;
            }

            case AnchorSlot.OsdOverlayBottom: {
                this.styleAsOverlay(element, 'bottom-center');
                container.appendChild(element);
                break;
            }

            case AnchorSlot.HeaderActions: {
                const navRight = container.querySelector('.headerRight, .MuiToolbar-root > div:last-child');
                if (navRight) {
                    navRight.appendChild(element);
                } else {
                    container.appendChild(element);
                }
                break;
            }

            default:
                container.appendChild(element);
                break;
        }
    }

    private styleAsOverlay(element: HTMLElement, position: 'top-right' | 'top-left' | 'top-center' | 'bottom-center'): void {
        element.style.position = 'absolute';
        element.style.zIndex = '1000';
        element.style.pointerEvents = 'auto';

        if (position === 'top-right') {
            element.style.top = '72px';
            element.style.right = '24px';
        } else if (position === 'top-left') {
            element.style.top = '72px';
            element.style.left = '24px';
        } else if (position === 'top-center') {
            element.style.top = '48px';
            element.style.left = '50%';
            element.style.transform = 'translateX(-50%)';
        } else if (position === 'bottom-center') {
            element.style.bottom = '120px';
            element.style.left = '50%';
            element.style.transform = 'translateX(-50%)';
        }
    }

    private startObservingPlayer(): void {
        const checkPlayer = () => {
            const playerRoot = this.getPlayerRoot();
            const wasMounted = this.isPlayerMounted;
            const nowMounted = playerRoot !== null && !playerRoot.classList.contains('hide');

            if (nowMounted !== wasMounted) {
                this.isPlayerMounted = nowMounted;
                for (const cb of this.mountListeners) {
                    try {
                        cb(nowMounted);
                    } catch (e) {
                        console.error('[PlayAdapt] Error in mount listener:', e);
                    }
                }
            }

            // Sync OSD visibility
            if (playerRoot) {
                const bottomControls = playerRoot.querySelector('.videoOsdBottom');
                const isHidden = bottomControls?.classList.contains('hide') || false;
                if (this.osdVisible === isHidden) {
                    this.osdVisible = !isHidden;
                    this.syncOsdVisibility(!isHidden);
                }
            }
        };

        this.playerObserver = new MutationObserver(() => {
            checkPlayer();
        });

        this.playerObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        // Initial check
        checkPlayer();
    }

    private syncOsdVisibility(visible: boolean): void {
        for (const [, { element }] of this.activeAttachments) {
            if (element.classList.contains('playadapt-sync-osd')) {
                element.style.opacity = visible ? '1' : '0';
                element.style.pointerEvents = visible ? 'auto' : 'none';
            }
        }
    }
}
