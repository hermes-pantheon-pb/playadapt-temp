using Jellyfin.Plugin.PlayAdapt.Middleware;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.PlayAdapt;

/// <summary>
/// Registers PlayAdapt middleware and services into Jellyfin's dependency injection container.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // Registers in-memory HTML injection filter that cleanly injects PlayAdapt client bundle
        // into web client responses without altering index.html or leaving any disk footprint.
        serviceCollection.AddTransient<IStartupFilter, PlayAdaptIndexHtmlInjectionFilter>();
    }
}
