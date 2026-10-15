using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MissingPersonAlert.Api.Data;
using MissingPersonAlert.Api.DTOs;
using MissingPersonAlert.Api.Models;
using MissingPersonAlert.Api.Services;

namespace MissingPersonAlert.Api.Controllers;

[ApiController]
[Route("api/cases")]
public sealed class CasesController(MissingPersonAlertDbContext database, PhotoStorageService photos) : ControllerBase
{
    [HttpGet("alerts")]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<AlertDto>>> GetAlerts(CancellationToken cancellationToken)
    {
        var cases = await database.MissingPersonCases.AsNoTracking()
            .Where(c => c.ReviewStatus == "Approved" && c.CaseStatus != "Closed")
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(cancellationToken);
        return Ok(cases.Select(ToPublicAlert).ToList());
    }

    [HttpGet("mine")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<MyCaseDto>>> GetMine(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var cases = await database.MissingPersonCases.AsNoTracking()
            .Where(c => c.CreatedByUserId == userId)
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(cancellationToken);
        return Ok(cases.Select(ToMyCase).ToList());
    }

    [HttpGet("{id:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<object>> GetById(int id, CancellationToken cancellationToken)
    {
        var item = await database.MissingPersonCases.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (item is null) return NotFound(new { message = "Case not found." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var isOwner = !string.IsNullOrEmpty(userId) && item.CreatedByUserId == userId;
        var canReview = User.IsInRole("Moderator") || User.IsInRole("Administrator");
        if (item.ReviewStatus == "Approved" && item.CaseStatus != "Closed") return Ok(ToPublicAlert(item));
        if (isOwner) return Ok(ToMyCase(item));
        if (canReview) return Ok(ToModeratorCase(item));
        return NotFound(new { message = "Case not found." });
    }

    [HttpPost]
    [Authorize]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult<object>> Create([FromForm] CreateMissingPersonRequest request, CancellationToken cancellationToken)
    {
        if (!request.ConfirmsRightToShare)
            return BadRequest(new { message = "Please confirm that you are authorised to submit the information and photograph." });
        if (request.Photo is null || request.Photo.Length <= 0)
            return BadRequest(new { message = "A recent photograph is required to submit a missing-person report." });
        if (string.IsNullOrWhiteSpace(request.ContactPhone))
            return BadRequest(new { message = "Contact phone is required." });
        if (string.IsNullOrWhiteSpace(request.ContactEmail))
            return BadRequest(new { message = "Contact email is required." });
        if (request.LastSeenAt!.Value > DateTimeOffset.UtcNow)
            return BadRequest(new { message = "Last-seen date and time cannot be in the future." });
        if (!request.LastSeenLatitude.HasValue || !request.LastSeenLongitude.HasValue)
            return BadRequest(new { message = "Select an approximate last-known location so the approved alert can appear on the map." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();

        var item = new MissingPersonCase
        {
            CaseReference = $"MPA-{DateTime.UtcNow:yyyy}-{Guid.NewGuid().ToString("N")[..8].ToUpperInvariant()}",
            PersonName = request.PersonName.Trim(),
            AgeAtDisappearance = request.AgeAtDisappearance,
            Description = request.Description.Trim(),
            ClothingDescription = request.ClothingDescription?.Trim(),
            LastSeenAt = request.LastSeenAt.Value,
            LastSeenLatitude = request.LastSeenLatitude,
            LastSeenLongitude = request.LastSeenLongitude,
            PublicAreaName = request.PublicAreaName.Trim(),
            ContactName = request.ContactName.Trim(),
            ContactPhone = request.ContactPhone.Trim(),
            ContactEmail = request.ContactEmail.Trim(),
            PublishContactDetails = request.PublishContactDetails,
            Circumstances = string.IsNullOrWhiteSpace(request.Circumstances) ? null : request.Circumstances.Trim(),
            ReviewStatus = "Pending",
            CaseStatus = "Active",
            CreatedByUserId = userId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        if (request.Photo is not null && request.Photo.Length > 0)
        {
            try
            {
                var stored = await photos.SaveAsync(request.Photo, cancellationToken);
                item.PhotoStorageKey = stored.StorageKey;
                item.PhotoContentType = stored.ContentType;
            }
            catch (InvalidDataException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        database.MissingPersonCases.Add(item);
        await database.SaveChangesAsync(cancellationToken);
        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = userId,
            Action = "CaseSubmitted",
            EntityType = "MissingPersonCase",
            EntityId = item.Id.ToString(),
            Notes = "Report submitted for moderator review.",
            CreatedAt = DateTimeOffset.UtcNow
        });
        await database.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetById), new { id = item.Id }, new
        {
            item.Id,
            item.CaseReference,
            item.ReviewStatus,
            message = "Report received and sent for review. It is not publicly visible yet."
        });
    }

    [HttpPut("{id:int}")]
    [Authorize]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult<object>> Update(int id, [FromForm] CreateMissingPersonRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();

        var item = await database.MissingPersonCases.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (item is null) return NotFound(new { message = "Report not found." });
        if (!string.Equals(item.CreatedByUserId, userId, StringComparison.Ordinal))
            return Forbid();
        if (item.CaseStatus != "Active")
            return Conflict(new { message = "A report cannot be edited after the case has been marked found or closed." });
        if (!request.ConfirmsRightToShare)
            return BadRequest(new { message = "Please confirm that the updated information and photograph are accurate and that you are authorised to share them." });
        if ((request.Photo is null || request.Photo.Length <= 0) && string.IsNullOrWhiteSpace(item.PhotoStorageKey))
            return BadRequest(new { message = "A recent photograph is required. Upload one before resubmitting this report." });
        if (string.IsNullOrWhiteSpace(request.ContactPhone))
            return BadRequest(new { message = "Contact phone is required." });
        if (string.IsNullOrWhiteSpace(request.ContactEmail))
            return BadRequest(new { message = "Contact email is required." });
        if (!request.LastSeenAt.HasValue || request.LastSeenAt.Value > DateTimeOffset.UtcNow)
            return BadRequest(new { message = "Last-seen date and time cannot be in the future." });
        if (!request.LastSeenLatitude.HasValue || !request.LastSeenLongitude.HasValue)
            return BadRequest(new { message = "Select an approximate last-known location so the report can appear on the map after approval." });

        // Audit the categories of fields changed, never the actual contact details or other sensitive values.
        var changedFields = new List<string>();
        if (!string.Equals(item.PersonName, request.PersonName.Trim(), StringComparison.Ordinal)) changedFields.Add("person name");
        if (item.AgeAtDisappearance != request.AgeAtDisappearance) changedFields.Add("age");
        if (!string.Equals(item.Description, request.Description.Trim(), StringComparison.Ordinal)) changedFields.Add("description");
        if (!string.Equals(item.ClothingDescription ?? string.Empty, request.ClothingDescription?.Trim() ?? string.Empty, StringComparison.Ordinal)) changedFields.Add("clothing description");
        if (item.LastSeenAt != request.LastSeenAt.Value) changedFields.Add("last-seen date/time");
        if (!string.Equals(item.PublicAreaName, request.PublicAreaName.Trim(), StringComparison.Ordinal)) changedFields.Add("last-known area");
        if (item.LastSeenLatitude != request.LastSeenLatitude || item.LastSeenLongitude != request.LastSeenLongitude) changedFields.Add("map coordinates");
        if (!string.Equals(item.ContactName, request.ContactName.Trim(), StringComparison.Ordinal) ||
            !string.Equals(item.ContactPhone, request.ContactPhone.Trim(), StringComparison.Ordinal) ||
            !string.Equals(item.ContactEmail, request.ContactEmail.Trim(), StringComparison.Ordinal)) changedFields.Add("reporter contact information");
        if (item.PublishContactDetails != request.PublishContactDetails) changedFields.Add("public contact consent");
        if (!string.Equals(item.Circumstances ?? string.Empty, request.Circumstances?.Trim() ?? string.Empty, StringComparison.Ordinal)) changedFields.Add("circumstances");
        if (request.Photo is { Length: > 0 }) changedFields.Add("recent photograph");

        string? newPhotoStorageKey = null;
        string? oldPhotoStorageKey = null;
        string? newPhotoContentType = null;
        if (request.Photo is not null && request.Photo.Length > 0)
        {
            try
            {
                var stored = await photos.SaveAsync(request.Photo, cancellationToken);
                newPhotoStorageKey = stored.StorageKey;
                newPhotoContentType = stored.ContentType;
                oldPhotoStorageKey = item.PhotoStorageKey;
            }
            catch (InvalidDataException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        var previousReviewStatus = item.ReviewStatus;
        item.PersonName = request.PersonName.Trim();
        item.AgeAtDisappearance = request.AgeAtDisappearance;
        item.Description = request.Description.Trim();
        item.ClothingDescription = request.ClothingDescription?.Trim();
        item.LastSeenAt = request.LastSeenAt.Value;
        item.LastSeenLatitude = request.LastSeenLatitude;
        item.LastSeenLongitude = request.LastSeenLongitude;
        item.PublicAreaName = request.PublicAreaName.Trim();
        item.ContactName = request.ContactName.Trim();
        item.ContactPhone = request.ContactPhone.Trim();
        item.ContactEmail = request.ContactEmail.Trim();
        item.PublishContactDetails = request.PublishContactDetails;
        item.Circumstances = string.IsNullOrWhiteSpace(request.Circumstances) ? null : request.Circumstances.Trim();
        if (newPhotoStorageKey is not null)
        {
            item.PhotoStorageKey = newPhotoStorageKey;
            item.PhotoContentType = newPhotoContentType;
        }

        // Every edit invalidates the previous approval. Public alert/map queries only return Approved cases.
        item.ReviewStatus = "Pending";
        item.ReviewedAt = null;
        item.ReviewedByUserId = null;
        item.ModerationReason = null;
        item.UpdatedAt = DateTimeOffset.UtcNow;

        // Related sightings are retained for audit, but their prior public approval is no longer valid
        // when the case details change; they must not reappear automatically after this report is reapproved.
        var relatedSightings = await database.Sightings
            .Where(s => s.CaseId == item.Id && (s.ReviewStatus == "Reviewed" || s.ReviewStatus == "Pending"))
            .ToListAsync(cancellationToken);
        foreach (var sighting in relatedSightings)
        {
            sighting.ReviewStatus = "HiddenCaseEdited";
            sighting.ReviewedAt = DateTimeOffset.UtcNow;
            sighting.ReviewedByUserId = userId;
        }

        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = userId,
            Action = "CaseEditedAndResubmitted",
            EntityType = "MissingPersonCase",
            EntityId = item.Id.ToString(),
            Notes = $"Owner resubmitted report for approval. Previous review status: {previousReviewStatus}. Fields changed: {(changedFields.Count > 0 ? string.Join(", ", changedFields) : "no field differences detected")}. Related sightings hidden: {relatedSightings.Count}. Sensitive field values are intentionally omitted.",
            CreatedAt = DateTimeOffset.UtcNow
        });
        database.Notifications.Add(new Notification
        {
            UserId = userId,
            CaseId = item.Id,
            Title = "Report resubmitted for approval",
            Message = "Your edited report has been sent to the administrator for review and is not currently public.",
            IsRead = false,
            CreatedAt = DateTimeOffset.UtcNow
        });

        await database.SaveChangesAsync(cancellationToken);
        if (oldPhotoStorageKey is not null) photos.DeleteIfExists(oldPhotoStorageKey);

        return Ok(new
        {
            item.Id,
            item.CaseReference,
            item.ReviewStatus,
            message = "Your report was updated and sent back for administrator approval. It is no longer public until approved again."
        });
    }

    [HttpGet("{id:int}/photo")]
    [AllowAnonymous]
    public async Task<IActionResult> GetPhoto(int id, CancellationToken cancellationToken)
    {
        var item = await database.MissingPersonCases.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (item is null || string.IsNullOrWhiteSpace(item.PhotoStorageKey)) return NotFound();
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var isOwner = !string.IsNullOrEmpty(userId) && item.CreatedByUserId == userId;
        var canReview = User.IsInRole("Moderator") || User.IsInRole("Administrator");
        var isPublic = item.ReviewStatus == "Approved" && item.CaseStatus != "Closed";
        if (!isPublic && !isOwner && !canReview) return NotFound();
        var path = photos.GetExistingPath(item.PhotoStorageKey);
        if (path is null) return NotFound();
        return PhysicalFile(path, item.PhotoContentType ?? "application/octet-stream", enableRangeProcessing: false);
    }

    internal static AlertDto ToPublicAlert(MissingPersonCase item) => new(
        item.Id, item.CaseReference, item.PersonName, item.AgeAtDisappearance, item.Description,
        item.ClothingDescription, item.LastSeenAt, item.PublicAreaName, item.PublishContactDetails,
        item.PublishContactDetails ? item.ContactName : null,
        item.PublishContactDetails ? item.ContactPhone : null,
        item.PublishContactDetails ? item.ContactEmail : null,
        item.LastSeenLatitude.HasValue ? Math.Round(item.LastSeenLatitude.Value, 2) : null,
        item.LastSeenLongitude.HasValue ? Math.Round(item.LastSeenLongitude.Value, 2) : null,
        string.IsNullOrWhiteSpace(item.PhotoStorageKey) ? null : $"/api/cases/{item.Id}/photo",
        item.ReviewStatus, item.CaseStatus, item.CreatedAt);

    internal static MyCaseDto ToMyCase(MissingPersonCase item) => new(
        item.Id, item.CaseReference, item.PersonName, item.AgeAtDisappearance, item.Description,
        item.ClothingDescription, item.LastSeenAt, item.PublicAreaName, item.ContactName,
        item.ContactPhone, item.ContactEmail, item.PublishContactDetails, item.Circumstances,
        item.LastSeenLatitude, item.LastSeenLongitude,
        string.IsNullOrWhiteSpace(item.PhotoStorageKey) ? null : $"/api/cases/{item.Id}/photo",
        item.ReviewStatus, item.CaseStatus, item.ModerationReason, item.CreatedAt, item.UpdatedAt);

    internal static ModeratorCaseDto ToModeratorCase(MissingPersonCase item) => new(
        item.Id, item.CaseReference, item.PersonName, item.AgeAtDisappearance, item.Description,
        item.ClothingDescription, item.LastSeenAt, item.PublicAreaName, item.ContactName,
        item.ContactPhone, item.ContactEmail, item.PublishContactDetails, item.Circumstances,
        string.IsNullOrWhiteSpace(item.PhotoStorageKey) ? null : $"/api/cases/{item.Id}/photo",
        item.ReviewStatus, item.CaseStatus, item.CreatedAt);
}
