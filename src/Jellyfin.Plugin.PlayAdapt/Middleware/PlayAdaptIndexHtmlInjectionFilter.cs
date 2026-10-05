using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PlayAdapt.Middleware;

/// <summary>
/// Intercepts Jellyfin web client index.html responses and dynamically injects
/// PlayAdapt web client bundle tags (CSS and JS) at runtime in memory.
/// Requires zero manual file modifications and leaves zero disk residue on uninstall.
/// </summary>
public sealed class PlayAdaptIndexHtmlInjectionFilter : IStartupFilter
{
    private readonly ILogger<PlayAdaptIndexHtmlInjectionFilter> _logger;
    private static readonly string BundleVersion =
        typeof(PlayAdaptIndexHtmlInjectionFilter).Assembly.GetName().Version?.ToString()
        ?? typeof(PlayAdaptIndexHtmlInjectionFilter).Module.ModuleVersionId.ToString("N");

    private const string ScriptMarker = "Plugins/PlayAdapt/Web/playadapt.bundle.js";

    public PlayAdaptIndexHtmlInjectionFilter(ILogger<PlayAdaptIndexHtmlInjectionFilter> logger)
    {
        _logger = logger;
    }

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.Use(InjectAsync);
            next(app);
        };
    }

    internal async Task InjectAsync(HttpContext context, Func<Task> nextMiddleware)
    {
        if (!IsIndexHtmlRequest(context.Request))
        {
            await nextMiddleware().ConfigureAwait(false);
            return;
        }

        // If plugin is explicitly disabled in admin settings, do not inject
        if (Plugin.Instance?.Configuration?.Enabled == false)
        {
            await nextMiddleware().ConfigureAwait(false);
            return;
        }

        // Disable upstream compression so we can inspect and rewrite uncompressed HTML
        context.Request.Headers.Remove("Accept-Encoding");

        var originalBody = context.Response.Body;
        using var captured = new MemoryStream();
        context.Response.Body = captured;

        try
        {
            await nextMiddleware().ConfigureAwait(false);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        captured.Seek(0, SeekOrigin.Begin);
        var contentType = context.Response.ContentType ?? string.Empty;
        var contentEncoding = context.Response.Headers["Content-Encoding"].ToString();
        if (!contentType.Contains("html", StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrWhiteSpace(contentEncoding))
        {
            await captured.CopyToAsync(originalBody).ConfigureAwait(false);
            return;
        }

        string html;
        using (var reader = new StreamReader(captured, Encoding.UTF8, leaveOpen: true))
        {
            html = await reader.ReadToEndAsync().ConfigureAwait(false);
        }

        if (string.IsNullOrEmpty(html) || html.Contains(ScriptMarker, StringComparison.Ordinal))
        {
            captured.Seek(0, SeekOrigin.Begin);
            await captured.CopyToAsync(originalBody).ConfigureAwait(false);
            return;
        }

        var prefix = context.Request.PathBase.HasValue
            ? context.Request.PathBase.Value!.TrimEnd('/')
            : string.Empty;

        var tags = $"\n    <!-- PlayAdapt Theme-Adaptive Player Engine Bundle -->\n"
                 + $"    <link rel=\"stylesheet\" href=\"{prefix}/Plugins/PlayAdapt/Web/playadapt.bundle.css?v={BundleVersion}\">\n"
                 + $"    <script defer src=\"{prefix}/Plugins/PlayAdapt/Web/playadapt.bundle.js?v={BundleVersion}\"></script>\n";

        var idx = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        var modified = idx >= 0
            ? html.Substring(0, idx) + tags + html.Substring(idx)
            : html + tags;

        var bytes = Encoding.UTF8.GetBytes(modified);
        context.Response.ContentLength = bytes.Length;
        context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        context.Response.Headers["Pragma"] = "no-cache";
        context.Response.Headers["Expires"] = "0";

        await originalBody.WriteAsync(bytes).ConfigureAwait(false);
        _logger.LogInformation("[PlayAdapt] Injected PlayAdapt player client bundle into {Path}", context.Request.Path);
    }

    private static bool IsIndexHtmlRequest(HttpRequest req)
    {
        if (!HttpMethods.IsGet(req.Method)) return false;
        var path = req.Path.Value ?? string.Empty;
        if (path.Equals("/", StringComparison.Ordinal)) return true;
        if (path.Equals("/web", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith("/web", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.Equals("/web/", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith("/index.html", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }
}
