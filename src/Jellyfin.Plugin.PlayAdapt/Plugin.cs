using System;
using System.Collections.Generic;
using System.IO;
using Jellyfin.Plugin.PlayAdapt.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.PlayAdapt;

/// <summary>
/// The main PlayAdapt theme-adaptive player enhancement plugin for Jellyfin.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        AutoCleanupOldPluginVersions(applicationPaths.PluginsPath);
    }

    /// <summary>
    /// Gets the current plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "PlayAdapt";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("f47a61d3-63d1-4475-8025-a134fa96328a");

    /// <inheritdoc />
    public override string Description => "Theme-adaptive player enhancement engine for Jellyfin official client.";

    /// <summary>
    /// Serves plugin admin configuration page in the Jellyfin Dashboard.
    /// </summary>
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = "playadapt",
                DisplayName = "PlayAdapt",
                EmbeddedResourcePath = string.Format("{0}.Configuration.configPage.html", GetType().Namespace),
                EnableInMainMenu = true,
                MenuIcon = "video_settings"
            }
        };
    }

    /// <inheritdoc />
    public override void OnUninstalling()
    {
        base.OnUninstalling();
        try
        {
            if (File.Exists(ConfigurationFilePath))
            {
                File.Delete(ConfigurationFilePath);
            }
        }
        catch
        {
            // Ignore any failure on uninstallation cleanup
        }
    }

    /// <summary>
    /// Automatically detects and purges stale version directories for this plugin to prevent
    /// Jellyfin dual-assembly loading and controller route collisions on server restart.
    /// </summary>
    private void AutoCleanupOldPluginVersions(string pluginsPath)
    {
        try
        {
            if (string.IsNullOrEmpty(pluginsPath) || !Directory.Exists(pluginsPath))
            {
                return;
            }

            var currentAssemblyLocation = typeof(Plugin).Assembly.Location;
            if (string.IsNullOrEmpty(currentAssemblyLocation))
            {
                return;
            }

            var currentDir = Path.GetDirectoryName(currentAssemblyLocation);
            if (string.IsNullOrEmpty(currentDir))
            {
                return;
            }

            var allPluginDirs = Directory.GetDirectories(pluginsPath);
            foreach (var dir in allPluginDirs)
            {
                if (string.Equals(Path.GetFullPath(dir), Path.GetFullPath(currentDir), StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var dirName = Path.GetFileName(dir);
                if (string.IsNullOrEmpty(dirName) || string.Equals(dirName, "configurations", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                bool isStalePlugin = false;
                var currentVersion = typeof(Plugin).Assembly.GetName().Version;
                var underscore = dirName.LastIndexOf('_');
                if (currentVersion != null
                    && underscore > 0
                    && dirName.Substring(0, underscore).Equals("PlayAdapt", StringComparison.OrdinalIgnoreCase)
                    && Version.TryParse(dirName.Substring(underscore + 1), out var dirVersion)
                    && dirVersion < currentVersion)
                {
                    isStalePlugin = true;
                }

                if (isStalePlugin)
                {
                    try
                    {
                        Directory.Delete(dir, recursive: true);
                    }
                    catch
                    {
                        try
                        {
                            foreach (var dll in Directory.GetFiles(dir, "*.dll"))
                            {
                                try
                                {
                                    var disabledName = dll + ".old_disabled";
                                    if (File.Exists(disabledName))
                                    {
                                        File.Delete(disabledName);
                                    }
                                    File.Move(dll, disabledName);
                                }
                                catch
                                {
                                }
                            }
                        }
                        catch
                        {
                        }
                    }
                }
            }
        }
        catch
        {
            // Non-critical, ignore
        }
    }
}
