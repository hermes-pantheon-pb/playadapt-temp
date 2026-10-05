import { ThemeTokens } from './types';

/**
 * ThemeInspector: Dynamically inspects the active Jellyfin theme in real-time,
 * extracting accent colors, surface materials, glassmorphism, border radii,
 * typography, and button metrics. Synthesizes these into unified CSS tokens.
 */
export class ThemeInspector {
    private static instance: ThemeInspector;
    private currentTokens: ThemeTokens;
    private styleElement: HTMLStyleElement | null = null;
    private observer: MutationObserver | null = null;
    private listeners: Array<(tokens: ThemeTokens) => void> = [];
    private customOverrides: string = '';

    private constructor() {
        this.currentTokens = this.getDefaultTokens();
    }

    public static getInstance(): ThemeInspector {
        if (!ThemeInspector.instance) {
            ThemeInspector.instance = new ThemeInspector();
        }
        return ThemeInspector.instance;
    }

    public init(customOverrides?: string): void {
        if (customOverrides) {
            this.customOverrides = customOverrides;
        }

        this.inspectAndApply();
        this.startObserving();
    }

    public setCustomOverrides(overrides: string): void {
        this.customOverrides = overrides;
        this.inspectAndApply();
    }

    public getTokens(): ThemeTokens {
        return { ...this.currentTokens };
    }

    public onThemeChange(callback: (tokens: ThemeTokens) => void): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Inspects active DOM elements and computed styles across the client.
     */
    public inspectAndApply(): ThemeTokens {
        try {
            const bodyStyle = window.getComputedStyle(document.body);
            const rootStyle = window.getComputedStyle(document.documentElement);

            // 1. Extract Accent Color
            let accent = this.inspectAccentColor(rootStyle, bodyStyle);

            // 2. Extract Surface & Glassmorphism Properties
            const { surfaceBg, surfaceBlur, surfaceBorder, surfaceShadow, isGlass } =
                this.inspectSurfaceProperties(bodyStyle);

            // 3. Extract Geometry (Border Radii)
            const { radiusBtn, radiusSurface } = this.inspectBorderRadii();

            // 4. Extract Button Dimensions & Metrics
            const { btnSize, btnIconSize } = this.inspectButtonMetrics();

            // 5. Extract Typography
            const fontFamily = bodyStyle.fontFamily || 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const textPrimary = bodyStyle.color && bodyStyle.color !== 'rgba(0, 0, 0, 0)'
                ? bodyStyle.color
                : '#ffffff';
            const textSecondary = 'rgba(255, 255, 255, 0.7)';

            // Derive hover & contrast
            const accentHover = this.deriveHoverColor(accent);
            const accentContrast = this.deriveContrastColor(accent);

            this.currentTokens = {
                accentColor: accent,
                accentHover,
                accentContrast,
                surfaceBg,
                surfaceBlur,
                surfaceBorder,
                surfaceShadow,
                radiusBtn,
                radiusSurface,
                fontFamily,
                btnSize,
                btnIconSize,
                textPrimary,
                textSecondary,
                isDarkTheme: true,
                isGlassTheme: isGlass
            };

            this.applyTokensToDom(this.currentTokens);
            this.notifyListeners(this.currentTokens);
        } catch (e) {
            console.warn('[PlayAdapt] Error during theme inspection, using safe defaults:', e);
            this.currentTokens = this.getDefaultTokens();
            this.applyTokensToDom(this.currentTokens);
        }

        return this.currentTokens;
    }

    private inspectAccentColor(rootStyle: CSSStyleDeclaration, bodyStyle: CSSStyleDeclaration): string {
        // A. Direct theme CSS variables
        const cssVarCandidates = [
            '--theme-primary',
            '--accent-color',
            '--primary-accent',
            '--theme-accent-text-color',
            '--button-background',
            '--primary',
            '--seer-inferred-color'
        ];

        for (const varName of cssVarCandidates) {
            const val = rootStyle.getPropertyValue(varName) || bodyStyle.getPropertyValue(varName);
            if (val && val.trim()) {
                const cleaned = val.trim();
                if (cleaned !== 'transparent' && cleaned !== 'inherit') {
                    return cleaned;
                }
            }
        }

        // B. Inspect active player elements or buttons
        const sampleElements = [
            document.querySelector('.btnPause'),
            document.querySelector('.osdPositionSlider'),
            document.querySelector('.button-submit'),
            document.querySelector('button.MuiIconButton-colorInherit'),
            document.querySelector('.headerRight .headerButton')
        ];

        for (const el of sampleElements) {
            if (el) {
                const comp = window.getComputedStyle(el);
                const bg = comp.backgroundColor;
                const col = comp.color;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !bg.includes('0, 0, 0')) {
                    return bg;
                }
                if (col && col !== 'rgba(0, 0, 0, 0)' && col !== 'transparent' && col !== 'rgb(255, 255, 255)') {
                    return col;
                }
            }
        }

        return '#00a4dc'; // Default Jellyfin Cyan
    }

    private inspectSurfaceProperties(_bodyStyle: CSSStyleDeclaration): {
        surfaceBg: string;
        surfaceBlur: string;
        surfaceBorder: string;
        surfaceShadow: string;
        isGlass: boolean;
    } {
        let surfaceBg = 'rgba(20, 20, 24, 0.85)';
        let surfaceBlur = '20px';
        let surfaceBorder = '1px solid rgba(255, 255, 255, 0.1)';
        let surfaceShadow = '0 8px 32px rgba(0, 0, 0, 0.45)';
        let isGlass = true;

        // Inspect player bottom / header / action sheets
        const surfaceCandidates = [
            document.querySelector('.videoOsdBottom'),
            document.querySelector('.osdControls'),
            document.querySelector('.skinHeader'),
            document.querySelector('.actionSheetContent'),
            document.querySelector('.dialog')
        ];

        for (const el of surfaceCandidates) {
            if (el) {
                const comp = window.getComputedStyle(el);
                const blur = comp.backdropFilter || (comp as any).webkitBackdropFilter;
                if (blur && blur !== 'none') {
                    surfaceBlur = blur;
                    isGlass = true;
                }

                const bg = comp.backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                    surfaceBg = bg;
                }

                const border = comp.border;
                if (border && border !== 'none' && !border.startsWith('0px')) {
                    surfaceBorder = border;
                }

                const shadow = comp.boxShadow;
                if (shadow && shadow !== 'none') {
                    surfaceShadow = shadow;
                }
                break;
            }
        }

        return { surfaceBg, surfaceBlur, surfaceBorder, surfaceShadow, isGlass };
    }

    private inspectBorderRadii(): { radiusBtn: string; radiusSurface: string } {
        let radiusBtn = '50%';
        let radiusSurface = '12px';

        const sampleBtn = document.querySelector('.buttons button, button[is="paper-icon-button-light"]');
        if (sampleBtn) {
            const comp = window.getComputedStyle(sampleBtn);
            if (comp.borderRadius) {
                radiusBtn = comp.borderRadius;
            }
        }

        const sampleSurface = document.querySelector('.card, .dialog, .actionSheetContent, .osdControls');
        if (sampleSurface) {
            const comp = window.getComputedStyle(sampleSurface);
            if (comp.borderRadius && comp.borderRadius !== '0px') {
                radiusSurface = comp.borderRadius;
            }
        }

        return { radiusBtn, radiusSurface };
    }

    private inspectButtonMetrics(): { btnSize: string; btnIconSize: string } {
        let btnSize = '42px';
        let btnIconSize = '24px';

        const sampleBtn = document.querySelector('.buttons button, button[is="paper-icon-button-light"]');
        if (sampleBtn) {
            const rect = sampleBtn.getBoundingClientRect();
            if (rect.width > 20 && rect.width < 80) {
                btnSize = `${Math.round(rect.width)}px`;
            }

            const icon = sampleBtn.querySelector('.material-icons, span');
            if (icon) {
                const comp = window.getComputedStyle(icon);
                if (comp.fontSize) {
                    btnIconSize = comp.fontSize;
                }
            }
        }

        return { btnSize, btnIconSize };
    }

    private deriveHoverColor(accent: string): string {
        return `color-mix(in srgb, ${accent} 85%, white)`;
    }

    private deriveContrastColor(_accent: string): string {
        return '#ffffff';
    }

    private applyTokensToDom(tokens: ThemeTokens): void {
        if (!this.styleElement) {
            this.styleElement = document.createElement('style');
            this.styleElement.id = 'playadapt-theme-tokens';
            document.head.appendChild(this.styleElement);
        }

        const css = `
:root, .playadapt-root {
    --playadapt-accent: ${tokens.accentColor};
    --playadapt-accent-hover: ${tokens.accentHover};
    --playadapt-accent-contrast: ${tokens.accentContrast};
    --playadapt-surface-bg: ${tokens.surfaceBg};
    --playadapt-surface-blur: ${tokens.surfaceBlur};
    --playadapt-surface-border: ${tokens.surfaceBorder};
    --playadapt-surface-shadow: ${tokens.surfaceShadow};
    --playadapt-radius-btn: ${tokens.radiusBtn};
    --playadapt-radius-surface: ${tokens.radiusSurface};
    --playadapt-font-family: ${tokens.fontFamily};
    --playadapt-btn-size: ${tokens.btnSize};
    --playadapt-btn-icon-size: ${tokens.btnIconSize};
    --playadapt-text-primary: ${tokens.textPrimary};
    --playadapt-text-secondary: ${tokens.textSecondary};
}
${this.customOverrides}
`;
        this.styleElement.textContent = css;
    }

    private startObserving(): void {
        if (this.observer) return;

        let debounceTimer: any = null;
        this.observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this.inspectAndApply();
            }, 150);
        });

        this.observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-theme']
        });

        this.observer.observe(document.head, {
            childList: true,
            subtree: true
        });
    }

    private notifyListeners(tokens: ThemeTokens): void {
        for (const cb of this.listeners) {
            try {
                cb(tokens);
            } catch (err) {
                console.error('[PlayAdapt] Error in theme change listener:', err);
            }
        }
    }

    private getDefaultTokens(): ThemeTokens {
        return {
            accentColor: '#00a4dc',
            accentHover: '#33b6e3',
            accentContrast: '#ffffff',
            surfaceBg: 'rgba(20, 20, 24, 0.85)',
            surfaceBlur: '20px',
            surfaceBorder: '1px solid rgba(255, 255, 255, 0.12)',
            surfaceShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
            radiusBtn: '50%',
            radiusSurface: '12px',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            btnSize: '42px',
            btnIconSize: '24px',
            textPrimary: '#ffffff',
            textSecondary: 'rgba(255, 255, 255, 0.7)',
            isDarkTheme: true,
            isGlassTheme: true
        };
    }
}
