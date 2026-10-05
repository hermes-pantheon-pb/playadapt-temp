/**
 * PlayAdapt Engine Types & Interfaces
 */

export interface ThemeTokens {
    accentColor: string;
    accentHover: string;
    accentContrast: string;
    surfaceBg: string;
    surfaceBlur: string;
    surfaceBorder: string;
    surfaceShadow: string;
    radiusBtn: string;
    radiusSurface: string;
    fontFamily: string;
    btnSize: string;
    btnIconSize: string;
    textPrimary: string;
    textSecondary: string;
    isDarkTheme: boolean;
    isGlassTheme: boolean;
}

export enum AnchorSlot {
    PlaybackControlsLeft = 'PlaybackControlsLeft',
    PlaybackControlsRight = 'PlaybackControlsRight',
    SecondaryControlsStart = 'SecondaryControlsStart',
    SecondaryControlsEnd = 'SecondaryControlsEnd',
    TimelinePrefix = 'TimelinePrefix',
    TimelineSuffix = 'TimelineSuffix',
    TimelineAbove = 'TimelineAbove',
    HeaderLeft = 'HeaderLeft',
    HeaderRight = 'HeaderRight',
    HeaderActions = 'HeaderActions',
    OsdOverlayTopLeft = 'OsdOverlayTopLeft',
    OsdOverlayTopRight = 'OsdOverlayTopRight',
    OsdOverlayBottom = 'OsdOverlayBottom',
    SecondaryMediaInfo = 'SecondaryMediaInfo',
    VideoViewport = 'VideoViewport',
    CustomFloatingDock = 'CustomFloatingDock'
}

export interface SlotAttachmentOptions {
    slot: AnchorSlot | string;
    element: HTMLElement;
    order?: number;
    wrapperClass?: string;
    maintainOsdVisibility?: boolean;
}

export interface ThemedButtonOptions {
    id: string;
    icon: string;
    label?: string;
    tooltip?: string;
    className?: string;
    active?: boolean;
    onClick?: (event: MouseEvent) => void;
}

export interface MenuItemOption {
    id: string;
    label: string;
    icon?: string;
    selected?: boolean;
    badge?: string;
    onClick: () => void;
}

export interface ThemedMenuOptions {
    id: string;
    title?: string;
    items: MenuItemOption[];
    anchorElement?: HTMLElement;
    customContent?: HTMLElement;
    onClose?: () => void;
}

export interface ThemedModalOptions {
    id: string;
    title: string;
    content: HTMLElement | string;
    actions?: Array<{
        label: string;
        primary?: boolean;
        onClick: () => void;
    }>;
    onClose?: () => void;
}

export interface ThemedSliderOptions {
    id: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    formatValue?: (val: number) => string;
    onChange: (value: number) => void;
}

export interface AspectMetadata {
    id: string;
    name: string;
    description: string;
    category: 'playback' | 'visual' | 'audio' | 'utility' | 'information';
    defaultEnabled: boolean;
    defaultSlot?: AnchorSlot | string;
    adminOnly?: boolean;
}

export interface PluginConfig {
    Enabled: boolean;
    EnableThemeInspection: boolean;
    EnableDebugMode: boolean;
    CustomThemeOverrides: string;
    Aspects: Array<{
        Id: string;
        Enabled: boolean;
        AdminOnly: boolean;
        CustomAnchorSlot?: string;
        OptionsJson: string;
    }>;
}
