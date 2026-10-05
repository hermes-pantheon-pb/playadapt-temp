using System;

namespace Jellyfin.Plugin.PlayAdapt.Configuration;

/// <summary>
/// Represents individual player aspect settings configured by the administrator.
/// </summary>
public class AspectConfiguration
{
    /// <summary>
    /// Unique identifier of the player aspect (e.g., "playback-speed", "quick-screenshot").
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether this aspect is enabled.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether this aspect is restricted to server administrators.
    /// </summary>
    public bool AdminOnly { get; set; } = false;

    /// <summary>
    /// Optional slot override (e.g. "PlaybackControlsRight", "ExtraControlsStart", "HeaderActions").
    /// Empty string uses the aspect's default intelligent anchor.
    /// </summary>
    public string CustomAnchorSlot { get; set; } = string.Empty;

    /// <summary>
    /// Deep configuration options serialized as JSON string.
    /// </summary>
    public string OptionsJson { get; set; } = "{}";
}
