import './styles/playadapt.scss';
import { ThemeInspector } from './engine/ThemeInspector';
import { LayoutResolver } from './engine/LayoutResolver';
import { ComponentFactory } from './engine/ComponentFactory';
import { PlayerController } from './player/PlayerController';
import { AspectRegistry } from './aspects/AspectRegistry';
import { PluginConfig } from './engine/types';

// Built-in showcase aspects
import { MediaInfoTagsAspect } from './aspects/builtin/MediaInfoTagsAspect';
import { PlaybackSpeedAspect } from './aspects/builtin/PlaybackSpeedAspect';
import { QuickScreenshotAspect } from './aspects/builtin/QuickScreenshotAspect';
import { StreamStatsAspect } from './aspects/builtin/StreamStatsAspect';
import { AudioBoostAspect } from './aspects/builtin/AudioBoostAspect';

(function initPlayAdapt() {
    'use strict';

    console.info('[PlayAdapt] Initializing Theme-Adaptive Player Engine for Jellyfin...');

    const PLUGIN_ID = 'f47a61d3-63d1-4475-8025-a134fa96328a';

    const themeInspector = ThemeInspector.getInstance();
    const layoutResolver = LayoutResolver.getInstance();
    const aspectRegistry = AspectRegistry.getInstance();
    const playerController = PlayerController.getInstance();
    const componentFactory = ComponentFactory.getInstance();

    // Default configuration fallback
    let currentConfig: PluginConfig = {
        Enabled: true,
        EnableThemeInspection: true,
        EnableDebugMode: false,
        CustomThemeOverrides: '',
        Aspects: [
            {
                Id: 'media-info-tags',
                Enabled: true,
                AdminOnly: false,
                CustomAnchorSlot: 'OsdOverlayTopLeft',
                OptionsJson: JSON.stringify({
                    position: 'TopLeft',
                    showBitrate: true,
                    showCodec: true,
                    showHdr: true,
                    showAudio: true,
                    showPlaybackMethod: true,
                    bitrateIntervalMs: 1000,
                    allowTranscodeDetailsNonAdmin: true
                })
            },
            {
                Id: 'playback-speed',
                Enabled: true,
                AdminOnly: false,
                OptionsJson: JSON.stringify({ presets: [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] })
            },
            {
                Id: 'quick-screenshot',
                Enabled: true,
                AdminOnly: false,
                OptionsJson: JSON.stringify({ format: 'image/png', quality: 0.95 })
            },
            {
                Id: 'stream-stats',
                Enabled: true,
                AdminOnly: false,
                OptionsJson: JSON.stringify({ refreshIntervalMs: 1000 })
            },
            {
                Id: 'audio-boost',
                Enabled: true,
                AdminOnly: false,
                OptionsJson: JSON.stringify({ maxGain: 2.5 })
            }
        ]
    };

    /**
     * Loads plugin configuration from Jellyfin API.
     */
    async function fetchConfiguration(): Promise<PluginConfig> {
        try {
            if ((window as any).ApiClient && typeof (window as any).ApiClient.getPluginConfiguration === 'function') {
                const config = await (window as any).ApiClient.getPluginConfiguration(PLUGIN_ID);
                if (config) {
                    return config;
                }
            } else {
                const res = await fetch('/Plugins/PlayAdapt/Configuration');
                if (res.ok) {
                    return await res.json();
                }
            }
        } catch (e) {
            console.debug('[PlayAdapt] Using default config fallback:', e);
        }
        return currentConfig;
    }

    /**
     * Initializes the engine components.
     */
    async function start() {
        const config = await fetchConfiguration();
        currentConfig = config;

        if (config.Enabled === false) {
            console.info('[PlayAdapt] PlayAdapt is disabled in configuration.');
            return;
        }

        // Initialize theme inspector
        if (config.EnableThemeInspection !== false) {
            themeInspector.init(config.CustomThemeOverrides);
        }

        // Initialize layout observer
        layoutResolver.init();

        // Register built-in aspects
        aspectRegistry.register(new MediaInfoTagsAspect());
        aspectRegistry.register(new PlaybackSpeedAspect());
        aspectRegistry.register(new QuickScreenshotAspect());
        aspectRegistry.register(new StreamStatsAspect());
        aspectRegistry.register(new AudioBoostAspect());

        // Initialize registry with loaded configuration
        aspectRegistry.init(config);

        // Listen for live config updates dispatched from admin dashboard
        window.addEventListener('playadapt:config-updated', ((e: CustomEvent<PluginConfig>) => {
            console.info('[PlayAdapt] Live config update received:', e.detail);
            currentConfig = e.detail;
            if (currentConfig.CustomThemeOverrides !== undefined) {
                themeInspector.setCustomOverrides(currentConfig.CustomThemeOverrides);
            }
            aspectRegistry.updateConfig(currentConfig);
        }) as EventListener);

        console.info('[PlayAdapt] Theme-Adaptive Player Engine successfully loaded.');
    }

    // Expose public developer API for runtime inspection and custom aspect registration
    (window as any).PlayAdapt = {
        version: '1.0.1',
        ThemeInspector: themeInspector,
        LayoutResolver: layoutResolver,
        ComponentFactory: componentFactory,
        PlayerController: playerController,
        AspectRegistry: aspectRegistry,
        registerAspect: (aspect: any) => aspectRegistry.register(aspect),
        unregisterAspect: (aspectId: string) => aspectRegistry.unregister(aspectId),
        inspectTheme: () => themeInspector.inspectAndApply(),
        getTokens: () => themeInspector.getTokens()
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
