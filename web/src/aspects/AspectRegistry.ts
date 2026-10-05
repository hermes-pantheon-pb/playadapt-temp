import { PlayerAspect, AspectContext } from './PlayerAspect';
import { PluginConfig } from '../engine/types';
import { ThemeInspector } from '../engine/ThemeInspector';
import { LayoutResolver } from '../engine/LayoutResolver';
import { ComponentFactory } from '../engine/ComponentFactory';
import { PlayerController } from '../player/PlayerController';

/**
 * AspectRegistry: Central registry and lifecycle manager for all player enhancements.
 */
export class AspectRegistry {
    private static instance: AspectRegistry;
    private aspects: Map<string, PlayerAspect> = new Map();
    private activeContexts: Map<string, AspectContext> = new Map();
    private currentConfig: PluginConfig | null = null;
    private isPlayerActive: boolean = false;

    private constructor() {}

    public static getInstance(): AspectRegistry {
        if (!AspectRegistry.instance) {
            AspectRegistry.instance = new AspectRegistry();
        }
        return AspectRegistry.instance;
    }

    public register(aspect: PlayerAspect): void {
        this.aspects.set(aspect.metadata.id, aspect);

        // If player is already active, evaluate and mount this aspect
        if (this.isPlayerActive && this.currentConfig) {
            this.evaluateAndMountAspect(aspect);
        }
    }

    public unregister(aspectId: string): void {
        const aspect = this.aspects.get(aspectId);
        if (aspect) {
            aspect.destroy();
            this.aspects.delete(aspectId);
            this.activeContexts.delete(aspectId);
        }
    }

    public init(config: PluginConfig): void {
        this.currentConfig = config;

        const layout = LayoutResolver.getInstance();
        layout.onMountChange((isMounted) => {
            this.isPlayerActive = isMounted;
            if (isMounted) {
                this.mountAllEnabledAspects();
            } else {
                this.unmountAllAspects();
            }
        });

        // If player is already mounted at init
        if (layout.isMounted()) {
            this.isPlayerActive = true;
            this.mountAllEnabledAspects();
        }
    }

    public updateConfig(newConfig: PluginConfig): void {
        this.currentConfig = newConfig;

        for (const [id, aspect] of this.aspects) {
            const aspectConf = newConfig.Aspects?.find(a => a.Id === id);
            const isEnabled = aspectConf ? aspectConf.Enabled : aspect.metadata.defaultEnabled;

            if (isEnabled) {
                let options = {};
                try {
                    options = JSON.parse(aspectConf?.OptionsJson || '{}');
                } catch (e) {
                    options = {};
                }

                if (this.activeContexts.has(id)) {
                    if (aspect.onConfigChange) {
                        aspect.onConfigChange(options);
                    }
                } else if (this.isPlayerActive) {
                    this.evaluateAndMountAspect(aspect);
                }
            } else {
                if (this.activeContexts.has(id)) {
                    if (aspect.onPlayerUnmount) aspect.onPlayerUnmount();
                    this.activeContexts.delete(id);
                }
            }
        }
    }

    private mountAllEnabledAspects(): void {
        for (const aspect of this.aspects.values()) {
            this.evaluateAndMountAspect(aspect);
        }
    }

    private evaluateAndMountAspect(aspect: PlayerAspect): void {
        if (!this.currentConfig) return;

        const aspectConf = this.currentConfig.Aspects?.find(a => a.Id === aspect.metadata.id);
        const isEnabled = aspectConf ? aspectConf.Enabled : aspect.metadata.defaultEnabled;

        if (!isEnabled) {
            return;
        }

        let options: Record<string, any> = {};
        try {
            options = JSON.parse(aspectConf?.OptionsJson || '{}');
        } catch (e) {
            options = {};
        }

        const context: AspectContext = {
            metadata: aspect.metadata,
            theme: ThemeInspector.getInstance(),
            layout: LayoutResolver.getInstance(),
            factory: ComponentFactory.getInstance(),
            player: PlayerController.getInstance(),
            options,
            slotOverride: aspectConf?.CustomAnchorSlot
        };

        this.activeContexts.set(aspect.metadata.id, context);

        try {
            aspect.init(context);
            if (aspect.onPlayerMount) {
                aspect.onPlayerMount(context);
            }
        } catch (err) {
            console.error(`[PlayAdapt] Error initializing aspect ${aspect.metadata.id}:`, err);
        }
    }

    private unmountAllAspects(): void {
        for (const [id, aspect] of this.aspects) {
            if (this.activeContexts.has(id)) {
                try {
                    if (aspect.onPlayerUnmount) aspect.onPlayerUnmount();
                } catch (e) {
                    console.error(`[PlayAdapt] Error unmounting aspect ${id}:`, e);
                }
            }
        }
        this.activeContexts.clear();
    }
}
