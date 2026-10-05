import { AspectMetadata } from '../engine/types';
import { ThemeInspector } from '../engine/ThemeInspector';
import { LayoutResolver } from '../engine/LayoutResolver';
import { ComponentFactory } from '../engine/ComponentFactory';
import { PlayerController } from '../player/PlayerController';

/**
 * Context provided to every player aspect when initialized.
 * Provides access to the theme synthesizer, spatial layout resolver,
 * native component factory, player controller, and aspect configuration.
 */
export interface AspectContext {
    metadata: AspectMetadata;
    theme: ThemeInspector;
    layout: LayoutResolver;
    factory: ComponentFactory;
    player: PlayerController;
    options: Record<string, any>;
    slotOverride?: string;
}

/**
 * PlayerAspect: The extensible unit of functionality added to the Jellyfin player.
 * Every aspect is decoupled from theme specifics, adapting to whatever theme is active.
 */
export interface PlayerAspect {
    readonly metadata: AspectMetadata;

    /**
     * Called once when the aspect is registered and activated.
     */
    init(context: AspectContext): void | Promise<void>;

    /**
     * Called whenever the video player mounts on the screen.
     */
    onPlayerMount?(context: AspectContext): void;

    /**
     * Called when the video player unmounts.
     */
    onPlayerUnmount?(): void;

    /**
     * Called when configuration is updated in real-time from the dashboard.
     */
    onConfigChange?(newOptions: Record<string, any>): void;

    /**
     * Called when the aspect is deactivated or destroyed.
     */
    destroy(): void;
}
