using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace MissingPersonAlert.Api.Services;

public sealed class PhotoStorageService(
    IWebHostEnvironment environment,
    IConfiguration configuration)
{
    private const long MaxPhotoBytes = 5 * 1024 * 1024;

    private string StorageFolder
    {
        get
        {
            // Azure can provide PhotoStorage__Path as an application setting.
            // If it is absent, keep using the existing local development path.
            var configuredPath = configuration["PhotoStorage:Path"];

            var path = string.IsNullOrWhiteSpace(configuredPath)
                ? Path.Combine(
                    environment.ContentRootPath,
                    "App_Data",
                    "private-uploads")
                : Path.IsPathRooted(configuredPath)
                    ? configuredPath
                    : Path.Combine(
                        environment.ContentRootPath,
                        configuredPath);

            return Path.GetFullPath(path);
        }
    }

    public async Task<(string StorageKey, string ContentType)> SaveAsync(
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        if (file is null || file.Length <= 0 || file.Length > MaxPhotoBytes)
        {
            throw new InvalidDataException(
                "The photograph must not be empty and must be 5 MB or smaller.");
        }

        var contentType = file.ContentType.ToLowerInvariant();

        if (contentType is not ("image/jpeg" or "image/png" or "image/webp"))
        {
            throw new InvalidDataException(
                "Only JPEG, PNG and WebP images are accepted.");
        }

        // Check the actual file signature instead of trusting the filename
        // or the Content-Type supplied by the browser.
        var header = new byte[12];

        await using (var input = file.OpenReadStream())
        {
            var read = await input.ReadAsync(
                header.AsMemory(0, header.Length),
                cancellationToken);

            if (!MatchesSignature(header, read, contentType))
            {
                throw new InvalidDataException(
                    "The uploaded file does not match an accepted image format.");
            }
        }

        var extension = contentType switch
        {
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            _ => throw new InvalidDataException("Unsupported image format.")
        };

        var storageKey = $"{Guid.NewGuid():N}{extension}";

        Directory.CreateDirectory(StorageFolder);

        var destination = GetPath(storageKey);

        await using var output = new FileStream(
            destination,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            81920,
            useAsync: true);

        await file.CopyToAsync(output, cancellationToken);

        return (storageKey, contentType);
    }

    public void DeleteIfExists(string? storageKey)
    {
        var path = GetExistingPath(storageKey);

        if (path is not null && File.Exists(path))
        {
            File.Delete(path);
        }
    }

    public string? GetExistingPath(string? storageKey)
    {
        if (string.IsNullOrWhiteSpace(storageKey))
        {
            return null;
        }

        var safeName = Path.GetFileName(storageKey);

        // Reject path traversal attempts.
        if (!string.Equals(
                safeName,
                storageKey,
                StringComparison.Ordinal))
        {
            return null;
        }

        var path = GetPath(safeName);

        return File.Exists(path) ? path : null;
    }

    private string GetPath(string key)
    {
        return Path.Combine(StorageFolder, Path.GetFileName(key));
    }

    private static bool MatchesSignature(
        byte[] bytes,
        int read,
        string contentType)
    {
        if (contentType == "image/jpeg")
        {
            return read >= 3
                && bytes[0] == 0xFF
                && bytes[1] == 0xD8
                && bytes[2] == 0xFF;
        }

        if (contentType == "image/png")
        {
            byte[] signature = [137, 80, 78, 71, 13, 10, 26, 10];

            return read >= signature.Length
                && bytes.Take(signature.Length).SequenceEqual(signature);
        }

        if (contentType == "image/webp")
        {
            return read >= 12
                && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF"
                && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP";
        }

        return false;
    }
}