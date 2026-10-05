import { PlayerAspect, AspectContext } from '../PlayerAspect';
import { AspectMetadata, AnchorSlot } from '../../engine/types';

/**
 * QuickScreenshotAspect: Captures clean, high-resolution video frames
 * without any UI clutter, with a camera flash effect and copy/download support.
 */
export class QuickScreenshotAspect implements PlayerAspect {
    public readonly metadata: AspectMetadata = {
        id: 'quick-screenshot',
        name: 'Quick Frame Snapshot',
        description: 'Captures full-resolution video frames with shutter effect and copy/download.',
        category: 'utility',
        defaultEnabled: true,
        defaultSlot: AnchorSlot.SecondaryControlsEnd
    };

    private button: HTMLButtonElement | null = null;
    private unmountSlot: (() => void) | null = null;

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

        this.button = context.factory.createThemedButton({
            id: 'playadapt-btn-screenshot',
            icon: 'photo_camera',
            tooltip: 'Take Clean Screenshot',
            onClick: async () => {
                await this.takeScreenshot(context);
            }
        });

        const slot = context.slotOverride || this.metadata.defaultSlot || AnchorSlot.SecondaryControlsEnd;
        this.unmountSlot = context.layout.attachToSlot({
            slot,
            element: this.button
        });
    }

    private async takeScreenshot(context: AspectContext): Promise<void> {
        this.triggerShutterFlash();

        const format = context.options.format || 'image/png';
        const quality = context.options.quality ?? 0.95;

        try {
            const result = await context.player.captureCurrentFrame({ format, quality });
            if (!result) {
                console.warn('[PlayAdapt] Screenshot capture returned empty.');
                return;
            }

            const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
            const timestamp = Math.floor(context.player.getCurrentTime());
            const filename = `jellyfin_frame_${timestamp}s.${ext}`;

            // 1. Copy to clipboard if supported
            let copied = false;
            if (navigator.clipboard && (window as any).ClipboardItem && format === 'image/png') {
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': result.blob })
                    ]);
                    copied = true;
                } catch (e) {
                    console.debug('[PlayAdapt] Clipboard write skipped:', e);
                }
            }

            // 2. Download file via Blob URL (compatible with Firefox Linux, Chrome, Edge, Safari)
            const blobUrl = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

            setTimeout(() => {
                if (a.parentElement) {
                    a.parentElement.removeChild(a);
                }
                URL.revokeObjectURL(blobUrl);
            }, 3000);

            // 3. Inform user with toast
            context.factory.showToast(copied ? '📸 Screenshot saved & copied to clipboard!' : '📸 Screenshot saved!');

            // 4. Briefly show check icon on button
            if (this.button) {
                const icon = this.button.querySelector('.material-icons');
                if (icon) {
                    const originalIcon = icon.textContent;
                    icon.textContent = 'check';
                    setTimeout(() => {
                        icon.textContent = originalIcon;
                    }, 1200);
                }
            }
        } catch (err: any) {
            console.error('[PlayAdapt] Error capturing screenshot:', err);
            const isCors = err?.name === 'SecurityError' || String(err).includes('tainted') || String(err).includes('insecure');
            context.factory.showToast(
                isCors
                    ? '⚠️ Direct frame capture restricted by stream CORS policy'
                    : '⚠️ Screenshot failed. Video stream may not be active.'
            );
        }
    }

    private triggerShutterFlash(): void {
        const flash = document.createElement('div');
        flash.className = 'playadapt-shutter-flash';
        document.body.appendChild(flash);
        setTimeout(() => {
            if (flash.parentElement) {
                flash.parentElement.removeChild(flash);
            }
        }, 300);
    }

    private cleanup(): void {
        if (this.unmountSlot) {
            this.unmountSlot();
            this.unmountSlot = null;
        }
        this.button = null;
    }
}
