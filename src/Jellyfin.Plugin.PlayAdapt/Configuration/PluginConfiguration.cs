using System.Collections.Generic;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.PlayAdapt.Configuration;

/// <summary>
/// Plugin configuration for PlayAdapt.
/// Stored in Jellyfin's configuration directory as an XML file.
/// Deleted automatically on plugin uninstallation for zero residue.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PluginConfiguration"/> class.
    /// </summary>
    public PluginConfiguration()
    {
        Enabled = true;
        EnableThemeInspection = true;
        EnableDebugMode = false;
        CustomThemeOverrides = string.Empty;
        Aspects = new List<AspectConfiguration>
        {
            new AspectConfiguration
            {
                Id = "media-info-tags",
                Enabled = true,
                AdminOnly = false,
                CustomAnchorSlot = "OsdOverlayTopLeft",
                OptionsJson = "{\"position\":\"TopLeft\", \"showBitrate\":true, \"showCodec\":true, \"showHdr\":true, \"showAudio\":true, \"showPlaybackMethod\":true, \"allowUserCustomization\":true, \"bitrateIntervalMs\":1000, \"allowTranscodeDetailsNonAdmin\":true}"
            },
            new AspectConfiguration
            {
                Id = "playback-speed",
                Enabled = true,
                AdminOnly = false,
                OptionsJson = "{\"presets\":[0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0], \"showCustomInput\": true}"
            },
            new AspectConfiguration
            {
                Id = "quick-screenshot",
                Enabled = true,
                AdminOnly = false,
                OptionsJson = "{\"format\":\"image/png\", \"quality\":0.95, \"copyToClipboard\": true, \"downloadFile\": true}"
            },
            new AspectConfiguration
            {
                Id = "stream-stats",
                Enabled = true,
                AdminOnly = false,
                OptionsJson = "{\"refreshIntervalMs\":1000, \"showBufferHealth\": true, \"showBitrate\": true, \"showResolution\": true}"
            },
            new AspectConfiguration
            {
                Id = "audio-boost",
                Enabled = true,
                AdminOnly = false,
                OptionsJson = "{\"maxGain\":3.0, \"defaultPreset\":\"speech\"}"
            }
        };
    }

    /// <summary>
    /// Gets or sets a value indicating whether the PlayAdapt injection engine is active.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether dynamic real-time theme inspection is enabled.
    /// When true, the client dynamically inspects the active theme's colors, radii, glassmorphism,
    /// typography, and layout structure.
    /// </summary>
    public bool EnableThemeInspection { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether debug mode is enabled on the client.
    /// Emits detailed theme inspection diagnostics and slot anchor visualization.
    /// </summary>
    public bool EnableDebugMode { get; set; }

    /// <summary>
    /// Gets or sets custom CSS variables or overrides to merge with synthesized theme tokens.
    /// </summary>
    public string CustomThemeOverrides { get; set; }

    /// <summary>
    /// Gets or sets the list of aspect-specific configurations.
    /// </summary>
    public List<AspectConfiguration> Aspects { get; set; }
}
