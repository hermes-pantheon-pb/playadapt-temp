import { PlayerAspect, AspectContext } from '../PlayerAspect';
import { AspectMetadata, AnchorSlot } from '../../engine/types';

/**
 * AudioBoostAspect: Dialogue enhancement and dynamic range compression via Web Audio API.
 */
export class AudioBoostAspect implements PlayerAspect {
    public readonly metadata: AspectMetadata = {
        id: 'audio-boost',
        name: 'Adaptive Dialogue & Audio Boost',
        description: 'Web Audio dynamic range compressor and speech clarifier.',
        category: 'audio',
        defaultEnabled: true,
        defaultSlot: AnchorSlot.SecondaryControlsStart
    };

    private button: HTMLButtonElement | null = null;
    private unmountSlot: (() => void) | null = null;
    private menuHandle: { element: HTMLElement; open: () => void; close: () => void } | null = null;
    private audioCtx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private isBoosted: boolean = false;
    private currentGain: number = 1.0;

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
        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            this.audioCtx.close().catch(() => {});
        }
    }

    private render(context: AspectContext): void {
        this.cleanup();

        this.button = context.factory.createThemedButton({
            id: 'playadapt-btn-audioboost',
            icon: 'graphic_eq',
            tooltip: 'Audio Dialogue Booster',
            onClick: () => {
                if (this.menuHandle) {
                    this.menuHandle.open();
                }
            }
        });

        // Create slider for gain level
        const maxGain = context.options.maxGain || 2.5;
        const sliderContent = document.createElement('div');
        sliderContent.className = 'playadapt-audio-popup-body';

        const label = document.createElement('div');
        label.className = 'playadapt-popup-label';
        label.textContent = 'Dialogue & Clarity Gain';
        sliderContent.appendChild(label);

        const slider = context.factory.createThemedSlider({
            id: 'playadapt-slider-gain',
            min: 1.0,
            max: maxGain,
            step: 0.25,
            value: this.currentGain,
            formatValue: (v) => `${v.toFixed(1)}x`,
            onChange: (v) => {
                this.currentGain = v;
                this.applyAudioGain(context, v);
            }
        });
        sliderContent.appendChild(slider);

        this.menuHandle = context.factory.createThemedMenu({
            id: 'playadapt-audio-menu',
            title: 'Audio Speech Boost',
            items: [
                {
                    id: 'audio_toggle',
                    label: this.isBoosted ? 'Disable Audio Normalization' : 'Enable Dialogue Compressor',
                    icon: 'tune',
                    selected: this.isBoosted,
                    onClick: () => {
                        this.toggleCompression(context);
                    }
                }
            ],
            customContent: sliderContent,
            anchorElement: this.button
        });

        const slot = context.slotOverride || this.metadata.defaultSlot || AnchorSlot.SecondaryControlsStart;
        this.unmountSlot = context.layout.attachToSlot({
            slot,
            element: this.button
        });
    }

    private toggleCompression(context: AspectContext): void {
        this.isBoosted = !this.isBoosted;
        this.applyAudioGain(context, this.isBoosted ? this.currentGain : 1.0);
        if (this.button) {
            if (this.isBoosted) {
                this.button.classList.add('playadapt-btn-active');
            } else {
                this.button.classList.remove('playadapt-btn-active');
            }
        }
    }

    private applyAudioGain(context: AspectContext, gainVal: number): void {
        try {
            const video = context.player.getVideo();
            if (!video) return;

            if (!this.audioCtx) {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                this.audioCtx = new AudioContextClass();
                const source = this.audioCtx.createMediaElementSource(video);

                this.compressor = this.audioCtx.createDynamicsCompressor();
                this.compressor.threshold.setValueAtTime(-24, this.audioCtx.currentTime);
                this.compressor.knee.setValueAtTime(30, this.audioCtx.currentTime);
                this.compressor.ratio.setValueAtTime(12, this.audioCtx.currentTime);
                this.compressor.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
                this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime);

                this.gainNode = this.audioCtx.createGain();
                this.gainNode.gain.setValueAtTime(gainVal, this.audioCtx.currentTime);

                source.connect(this.compressor);
                this.compressor.connect(this.gainNode);
                this.gainNode.connect(this.audioCtx.destination);
            } else if (this.gainNode) {
                this.gainNode.gain.setValueAtTime(gainVal, this.audioCtx.currentTime);
            }
        } catch (e) {
            console.debug('[PlayAdapt] Audio boost connection notice:', e);
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
        this.button = null;
    }
}
