import { PlayerAspect, AspectContext } from '../PlayerAspect';
import { AspectMetadata, AnchorSlot } from '../../engine/types';

/**
 * StreamStatsAspect: Completely new floating HUD object styled natively with theme
 * glassmorphism and geometry, displaying real-time video buffer and playback stats.
 */
export class StreamStatsAspect implements PlayerAspect {
    public readonly metadata: AspectMetadata = {
        id: 'stream-stats',
        name: 'Stream Stats & HUD Overlay',
        description: 'Native glassmorphic HUD card showing resolution, buffer health, and frame drops.',
        category: 'information',
        defaultEnabled: true,
        defaultSlot: AnchorSlot.OsdOverlayTopRight
    };

    private toggleButton: HTMLButtonElement | null = null;
    private hudCard: HTMLElement | null = null;
    private isVisible: boolean = false;
    private timer: any = null;
    private unmountButton: (() => void) | null = null;
    private unmountHud: (() => void) | null = null;

    public init(context: AspectContext): void {
        this.render(context);
    }

    public onPlayerMount(context: AspectContext): void {
        this.render(context);
    }

    public onPlayerUnmount(): void {
        this.cleanup();
    }

    public destroy(): void {
        this.cleanup();
    }

    private render(context: AspectContext): void {
        this.cleanup();

        // 1. Create toggle button in controls
        this.toggleButton = context.factory.createThemedButton({
            id: 'playadapt-btn-stats',
            icon: 'query_stats',
            tooltip: 'Toggle Stream Stats HUD',
            onClick: () => {
                this.toggleHud();
            }
        });

        this.unmountButton = context.layout.attachToSlot({
            slot: AnchorSlot.SecondaryControlsEnd,
            element: this.toggleButton
        });

        // 2. Create completely new HUD Card object
        this.hudCard = context.factory.createThemedCard('playadapt-stats-hud', 'playadapt-sync-osd');
        this.hudCard.style.display = 'none';

        this.unmountHud = context.layout.attachToSlot({
            slot: context.slotOverride || this.metadata.defaultSlot || AnchorSlot.OsdOverlayTopRight,
            element: this.hudCard
        });

        const refreshInterval = context.options.refreshIntervalMs || 1000;
        this.timer = setInterval(() => {
            if (this.isVisible && this.hudCard) {
                this.updateStats(context);
            }
        }, refreshInterval);
    }

    private toggleHud(): void {
        this.isVisible = !this.isVisible;
        if (this.hudCard) {
            this.hudCard.style.display = this.isVisible ? 'block' : 'none';
        }
        if (this.toggleButton) {
            if (this.isVisible) {
                this.toggleButton.classList.add('playadapt-btn-active');
            } else {
                this.toggleButton.classList.remove('playadapt-btn-active');
            }
        }
    }

    private updateStats(context: AspectContext): void {
        if (!this.hudCard) return;

        const stats = context.player.getStreamStats();
        const bufferWidth = Math.min(100, (stats.bufferHealthSeconds / 60) * 100);

        this.hudCard.innerHTML = `
            <div class="playadapt-hud-header">
                <span class="material-icons" style="font-size: 16px; color: var(--playadapt-accent);">query_stats</span>
                <span class="playadapt-hud-title">Stream Diagnostics</span>
            </div>
            <div class="playadapt-hud-grid">
                <div class="playadapt-hud-item">
                    <span class="playadapt-hud-label">Resolution</span>
                    <span class="playadapt-hud-value">${stats.resolution}</span>
                </div>
                <div class="playadapt-hud-item">
                    <span class="playadapt-hud-label">Position</span>
                    <span class="playadapt-hud-value">${stats.currentTimeFormatted} / ${stats.durationFormatted}</span>
                </div>
                <div class="playadapt-hud-item">
                    <span class="playadapt-hud-label">Buffer Ahead</span>
                    <span class="playadapt-hud-value">${stats.bufferHealthSeconds}s</span>
                </div>
                <div class="playadapt-hud-item">
                    <span class="playadapt-hud-label">Dropped Frames</span>
                    <span class="playadapt-hud-value">${stats.droppedFrames}</span>
                </div>
            </div>
            <div class="playadapt-hud-meter">
                <div class="playadapt-hud-meter-fill" style="width: ${bufferWidth}%;"></div>
            </div>
        `;
    }

    private cleanup(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.unmountButton) {
            this.unmountButton();
            this.unmountButton = null;
        }
        if (this.unmountHud) {
            this.unmountHud();
            this.unmountHud = null;
        }
        this.toggleButton = null;
        this.hudCard = null;
        this.isVisible = false;
    }
}
