using System;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using Jellyfin.Plugin.PlayAdapt.Configuration;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PlayAdapt.Controllers;

/// <summary>
/// Controller for serving embedded PlayAdapt client assets and managing player aspect configurations.
/// </summary>
[ApiController]
[Route("Plugins/PlayAdapt")]
public class PlayAdaptController : ControllerBase
{
    private readonly ILogger<PlayAdaptController> _logger;

    public PlayAdaptController(ILogger<PlayAdaptController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Serves embedded web assets (playadapt.bundle.js, playadapt.bundle.css) with HTTP cache headers.
    /// </summary>
    [HttpGet("Web/{filename}")]
    [AllowAnonymous]
    public IActionResult GetWebAsset(string filename)
    {
        var sanitizedFilename = Path.GetFileName(filename);
        var resourceName = $"Jellyfin.Plugin.PlayAdapt.Web.{sanitizedFilename}";
        var assembly = Assembly.GetExecutingAssembly();

        var stream = assembly.GetManifestResourceStream(resourceName);
        if (stream == null)
        {
            return NotFound($"Asset '{sanitizedFilename}' not found.");
        }

        var contentType = sanitizedFilename.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
            ? "text/css"
            : sanitizedFilename.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
                ? "application/javascript"
                : "application/octet-stream";

        if (Request.Query.ContainsKey("v"))
        {
            Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
        else
        {
            Response.Headers["Cache-Control"] = "public, max-age=3600";
        }

        return File(stream, contentType);
    }

    /// <summary>
    /// Gets the current PlayAdapt configuration.
    /// </summary>
    [HttpGet("Configuration")]
    [AllowAnonymous]
    public ActionResult<PluginConfiguration> GetConfiguration()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        return Ok(config);
    }

    /// <summary>
    /// Updates an individual aspect's enabled state and options.
    /// </summary>
    [HttpPost("Configuration/Aspect/{aspectId}")]
    [Authorize(Policy = "RequiresElevation")]
    public ActionResult UpdateAspectConfig(string aspectId, [FromBody] AspectConfiguration aspectConfig)
    {
        if (Plugin.Instance == null)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, "Plugin instance not initialized.");
        }

        var config = Plugin.Instance.Configuration;
        var existing = config.Aspects.Find(a => a.Id.Equals(aspectId, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            existing.Enabled = aspectConfig.Enabled;
            existing.AdminOnly = aspectConfig.AdminOnly;
            existing.CustomAnchorSlot = aspectConfig.CustomAnchorSlot;
            existing.OptionsJson = aspectConfig.OptionsJson;
        }
        else
        {
            config.Aspects.Add(aspectConfig);
        }

        Plugin.Instance.SaveConfiguration();
        return Ok(config);
    }

    /// <summary>
    /// Gets the status and loaded aspects metadata of the PlayAdapt engine.
    /// </summary>
    [HttpGet("Status")]
    [AllowAnonymous]
    public IActionResult GetStatus()
    {
        var version = typeof(PlayAdaptController).Assembly.GetName().Version?.ToString() ?? "1.0.0.0";
        var isEnabled = Plugin.Instance?.Configuration?.Enabled ?? true;

        return Ok(new
        {
            Plugin = "PlayAdapt",
            Version = version,
            Active = isEnabled,
            ThemeInspection = Plugin.Instance?.Configuration?.EnableThemeInspection ?? true,
            AspectCount = Plugin.Instance?.Configuration?.Aspects.Count ?? 0
        });
    }
}
