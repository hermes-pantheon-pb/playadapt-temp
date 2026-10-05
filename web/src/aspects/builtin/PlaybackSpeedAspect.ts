import { PlayerAspect, AspectContext } from '../PlayerAspect';
import { AspectMetadata, AnchorSlot } from '../../engine/types';

/**
 * PlaybackSpeedAspect: Adds a seamless, theme-adaptive playback speed selector.
 */
export class PlaybackSpeedAspect implements PlayerAspect {
    public readonly metadata: AspectMetadata = {
        id: 'playback-speed',
        name: 'Playback Speed Controller',
        description: 'Adaptive playback speed button and floating menu sheet.',
        category: 'playback',
        defaultEnabled: true,
        defaultSlot: AnchorSlot.SecondaryControlsStart
    };

    private button: HTMLButtonElement | null = null;
    private unmountSlot: (() => void) | null = null;
    private menuHandle: { element: HTMLElement; open: () => void; close: () => void } | null = null;
    private unbindRateChange: (() => void) | null = null;

    public init(context: AspectContext): void {
        this.render(context);
    }

    public onPlayerMount(context: AspectContext): void {
        this.render(context);
    }

    public onPlayerUnmount(): void {
        this.cleanup();
    }

    public onConfigChange(_newOptions: Record<string, any>): void {
        if (this.button) {
            // Re-render menu with new presets
            this.cleanup();
        }
    }

    public destroy(): void {
        this.cleanup();
    }

    private render(context: AspectContext): void {
        this.cleanup();

        const currentRate = context.player.getPlaybackRate();
        const presets: number[] = context.options.presets || [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

        // 1. Create themed button
        this.button = context.factory.createThemedButton({
            id: 'playadapt-btn-speed',
            icon: 'speed',
            tooltip: `Playback Speed (${currentRate}x)`,
            onClick: () => {
                if (this.menuHandle) {
                    this.menuHandle.open();
                }
            }
        });

        // 2. Create themed popup sheet
        const menuItems = presets.map((rate) => ({
            id: `speed_${rate}`,
            label: `${rate}x Speed`,
            selected: Math.abs(currentRate - rate) < 0.05,
            onClick: () => {
                context.player.setPlaybackRate(rate);
                this.updateButtonLabel(rate);
            }
        }));

        this.menuHandle = context.factory.createThemedMenu({
            id: 'playadapt-speed-menu',
            title: 'Playback Speed',
            items: menuItems,
            anchorElement: this.button
        });

        // 3. Attach button to resolved layout slot
        const slot = context.slotOverride || this.metadata.defaultSlot || AnchorSlot.SecondaryControlsStart;
        this.unmountSlot = context.layout.attachToSlot({
            slot,
            element: this.button
        });

        // 4. Synchronize with external rate changes
        this.unbindRateChange = context.player.on('ratechange', (newRate: number) => {
            this.updateButtonLabel(newRate);
        });
    }

    private updateButtonLabel(rate: number): void {
        if (this.button) {
            this.button.title = `Playback Speed (${rate}x)`;
        }
    }

    private cleanup(): void {
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
        if (this.unbindRateChange) {
            this.unbindRateChange();
            this.unbindRateChange = null;
        }
        this.button = null;
    }
}
