using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MissingPersonAlert.Api.Data;
using MissingPersonAlert.Api.DTOs;
using MissingPersonAlert.Api.Hubs;
using MissingPersonAlert.Api.Models;

namespace MissingPersonAlert.Api.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Roles = "Moderator,Administrator")]
public sealed class AdminController(MissingPersonAlertDbContext database, IHubContext<AlertHub> hub) : ControllerBase
{
    [HttpGet("audit-trail")]
    [Authorize(Roles = "Administrator")]
    public async Task<ActionResult<AuditTrailPageDto>> GetAuditTrail(
        [FromQuery] int skip = 0,
        [FromQuery] int take = 25,
        [FromQuery] string? search = null,
        [FromQuery] string? action = null,
        CancellationToken cancellationToken = default)
    {
        skip = Math.Max(0, skip);
        take = Math.Clamp(take, 10, 100);
        var query = database.AuditLogs.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(action) && !string.Equals(action, "All", StringComparison.OrdinalIgnoreCase))
        {
            var actionFilter = action.Trim();
            query = query.Where(log => log.Action == actionFilter);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(log =>
                log.Action.Contains(term) ||
                log.EntityType.Contains(term) ||
                log.EntityId.Contains(term) ||
                (log.Notes != null && log.Notes.Contains(term)) ||
                database.Users.Any(user => user.Id == log.ActorUserId &&
                    (user.DisplayName.Contains(term) || (user.Email != null && user.Email.Contains(term)))) ||
                (log.EntityType == "MissingPersonCase" && database.MissingPersonCases.Any(item => item.Id.ToString() == log.EntityId &&
                    (item.CaseReference.Contains(term) || item.PersonName.Contains(term) || item.PublicAreaName.Contains(term)))) ||
                (log.EntityType == "Sighting" && database.Sightings.Any(item => item.Id.ToString() == log.EntityId &&
                    (item.PublicAreaName.Contains(term) || item.Description.Contains(term) ||
                     (item.Case != null && (item.Case.CaseReference.Contains(term) || item.Case.PersonName.Contains(term)))))));
        }

        var total = await query.CountAsync(cancellationToken);
        var rows = await query.OrderByDescending(log => log.CreatedAt).ThenByDescending(log => log.Id)
            .Skip(skip).Take(take).ToListAsync(cancellationToken);

        var actorIds = rows.Select(log => log.ActorUserId).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().ToArray();
        var actors = await database.Users.AsNoTracking()
            .Where(user => actorIds.Contains(user.Id))
            .Select(user => new { user.Id, user.DisplayName, user.Email })
            .ToDictionaryAsync(user => user.Id, cancellationToken);

        var caseIds = rows.Where(log => log.EntityType == "MissingPersonCase")
            .Select(log => int.TryParse(log.EntityId, out var id) ? (int?)id : null)
            .Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToArray();
        var cases = await database.MissingPersonCases.AsNoTracking()
            .Where(item => caseIds.Contains(item.Id))
            .Select(item => new { item.Id, item.CaseReference, item.PersonName, item.PublicAreaName, item.CaseStatus, item.ReviewStatus })
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        var sightingIds = rows.Where(log => log.EntityType == "Sighting")
            .Select(log => int.TryParse(log.EntityId, out var id) ? (int?)id : null)
            .Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToArray();
        var sightings = await database.Sightings.AsNoTracking().Where(item => sightingIds.Contains(item.Id))
            .Select(item => new
            {
                item.Id, item.CaseId, item.PublicAreaName,
                CaseReference = item.Case == null ? null : item.Case.CaseReference,
                PersonName = item.Case == null ? null : item.Case.PersonName
            }).ToDictionaryAsync(item => item.Id, cancellationToken);

        var items = rows.Select(log =>
        {
            var actor = actors.GetValueOrDefault(log.ActorUserId);
            string? entityLabel = null;
            if (log.EntityType == "MissingPersonCase" && int.TryParse(log.EntityId, out var caseId) && cases.TryGetValue(caseId, out var caseItem))
                entityLabel = $"{caseItem.CaseReference} — {caseItem.PersonName} ({caseItem.PublicAreaName})";
            else if (log.EntityType == "Sighting" && int.TryParse(log.EntityId, out var sightingId) && sightings.TryGetValue(sightingId, out var sighting))
            {
                var sightingCaseReference = sighting.CaseReference ?? $"Case #{sighting.CaseId}";
                var sightingPersonName = sighting.PersonName ?? "Missing person";
                entityLabel = $"{sightingCaseReference} — {sightingPersonName}; {sighting.PublicAreaName}";
            }
            else if (log.EntityType == "AreaSubscription") entityLabel = $"Area subscription #{log.EntityId}";
            else if (log.EntityType == "User") entityLabel = actor?.Email ?? $"User #{log.EntityId}";

            var actorDisplayName = actor?.DisplayName ?? (string.Equals(log.ActorUserId, "anonymous", StringComparison.Ordinal) ? "Anonymous visitor" : "Unavailable account");
            return new AuditTrailEntryDto(
                log.Id, log.ActorUserId, actorDisplayName, actor?.Email,
                log.Action, log.EntityType, log.EntityId, entityLabel, log.Notes, log.CreatedAt);
        }).ToList();

        return Ok(new AuditTrailPageDto(items, total, skip, take));
    }

    [HttpGet("cases/pending")]
    public async Task<ActionResult<IReadOnlyList<ModeratorCaseDto>>> GetPendingCases(CancellationToken cancellationToken)
    {
        var items = await database.MissingPersonCases.AsNoTracking()
            .Where(c => c.ReviewStatus == "Pending")
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(CasesController.ToModeratorCase).ToList());
    }

    [HttpPost("cases/{id:int}/approve")]
    public async Task<ActionResult<AlertDto>> ApproveCase(int id, [FromBody] ReviewReasonRequest? request, CancellationToken cancellationToken)
    {
        var item = await database.MissingPersonCases.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (item is null) return NotFound(new { message = "Case not found." });
        if (item.ReviewStatus != "Pending") return Conflict(new { message = "Only pending reports can be approved." });

        var reviewerId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        item.ReviewStatus = "Approved";
        item.ReviewedAt = DateTimeOffset.UtcNow;
        item.ReviewedByUserId = reviewerId;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        item.ModerationReason = string.IsNullOrWhiteSpace(request?.Reason) ? null : request.Reason.Trim();
        database.AuditLogs.Add(new AuditLog { ActorUserId = reviewerId, Action = "CaseApproved", EntityType = "MissingPersonCase", EntityId = item.Id.ToString(), Notes = item.ModerationReason });

        var areaSubscriptions = await database.AreaSubscriptions.AsNoTracking().ToListAsync(cancellationToken);
        var recipientIds = areaSubscriptions
            .Where(s => string.Equals(s.AreaName.Trim(), item.PublicAreaName.Trim(), StringComparison.OrdinalIgnoreCase))
            .Select(s => s.UserId)
            .Append(item.CreatedByUserId)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        var notifications = recipientIds.Select(userId => new Notification
        {
            UserId = userId,
            CaseId = item.Id,
            Title = "Missing-person alert approved",
            Message = $"A report for {item.PublicAreaName} has been approved by an application moderator.",
            IsRead = false,
            CreatedAt = DateTimeOffset.UtcNow
        }).ToList();
        database.Notifications.AddRange(notifications);
        await database.SaveChangesAsync(cancellationToken);

        var alert = CasesController.ToPublicAlert(item);
        await hub.Clients.All.SendAsync("AlertApproved", alert, cancellationToken);
        foreach (var notification in notifications)
        {
            await hub.Clients.User(notification.UserId).SendAsync("NotificationReceived", new NotificationDto(notification.Id, notification.CaseId, notification.Title, notification.Message, notification.IsRead, notification.CreatedAt), cancellationToken);
        }
        return Ok(alert);
    }

    [HttpPost("cases/{id:int}/reject")]
    public async Task<IActionResult> RejectCase(int id, [FromBody] ReviewReasonRequest? request, CancellationToken cancellationToken)
    {
        var item = await database.MissingPersonCases.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (item is null) return NotFound(new { message = "Case not found." });
        if (item.ReviewStatus != "Pending") return Conflict(new { message = "Only pending reports can be rejected." });
        var reviewerId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        item.ReviewStatus = "Rejected";
        item.ReviewedAt = DateTimeOffset.UtcNow;
        item.ReviewedByUserId = reviewerId;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        item.ModerationReason = string.IsNullOrWhiteSpace(request?.Reason) ? "Not approved for public sharing." : request.Reason.Trim();
        database.AuditLogs.Add(new AuditLog { ActorUserId = reviewerId, Action = "CaseRejected", EntityType = "MissingPersonCase", EntityId = item.Id.ToString(), Notes = item.ModerationReason });
        database.Notifications.Add(new Notification { UserId = item.CreatedByUserId, CaseId = item.Id, Title = "Report review update", Message = "Your submission was not approved for public sharing. Sign in to review the case status or contact the project administrator.", CreatedAt = DateTimeOffset.UtcNow });
        await database.SaveChangesAsync(cancellationToken);
        return Ok(new { item.Id, item.ReviewStatus, message = "Report rejected and kept out of public alerts." });
    }

    [HttpPatch("cases/{id:int}/status")]
    public async Task<ActionResult<AlertDto>> UpdateCaseStatus(int id, CaseStatusUpdateRequest request, CancellationToken cancellationToken)
    {
        var status = request.Status.Trim();
        if (status is not ("Active" or "FoundSafe" or "FoundDeceased" or "Closed"))
            return BadRequest(new { message = "Allowed statuses are Active, FoundSafe, FoundDeceased or Closed." });
        var item = await database.MissingPersonCases.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (item is null || item.ReviewStatus != "Approved") return NotFound(new { message = "Approved case not found." });
        var reviewerId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        var previous = item.CaseStatus;
        item.CaseStatus = status;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        var suppressedSightingCount = 0;
        if (status is "FoundSafe" or "FoundDeceased" or "Closed")
        {
            // Preserve sighting records for audit purposes, but hide related sightings from public maps
            // and moderation queues once the case is resolved or closed.
            var relatedSightings = await database.Sightings
                .Where(s => s.CaseId == item.Id && (s.ReviewStatus == "Reviewed" || s.ReviewStatus == "Pending"))
                .ToListAsync(cancellationToken);
            foreach (var sighting in relatedSightings)
            {
                sighting.ReviewStatus = "HiddenCaseResolved";
                sighting.ReviewedAt = DateTimeOffset.UtcNow;
                sighting.ReviewedByUserId = reviewerId;
            }
            suppressedSightingCount = relatedSightings.Count;
        }
        var auditNotes = status is "FoundSafe" or "FoundDeceased" or "Closed"
            ? $"{previous} -> {status}; suppressed {suppressedSightingCount} related sighting(s) from public display."
            : $"{previous} -> {status}";
        database.AuditLogs.Add(new AuditLog { ActorUserId = reviewerId, Action = "CaseStatusChanged", EntityType = "MissingPersonCase", EntityId = item.Id.ToString(), Notes = auditNotes });
        var areaSubscriptions = await database.AreaSubscriptions.AsNoTracking().ToListAsync(cancellationToken);
        var recipients = areaSubscriptions
            .Where(s => string.Equals(s.AreaName.Trim(), item.PublicAreaName.Trim(), StringComparison.OrdinalIgnoreCase))
            .Select(s => s.UserId)
            .Append(item.CreatedByUserId)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var message = status switch
        {
            "FoundSafe" => "The case status has been updated to Found Safe by an application moderator.",
            "FoundDeceased" => "The case status has been updated to Found Deceased by an application moderator.",
            "Closed" => "The case has been closed by an application moderator.",
            _ => $"The case status has been updated to {status}."
        };
        var notifications = recipients.Select(userId => new Notification
        {
            UserId = userId,
            CaseId = item.Id,
            Title = "Case status updated",
            Message = message,
            CreatedAt = DateTimeOffset.UtcNow
        }).ToList();
        database.Notifications.AddRange(notifications);
        await database.SaveChangesAsync(cancellationToken);
        var alert = CasesController.ToPublicAlert(item);
        await hub.Clients.All.SendAsync("CaseStatusChanged", alert, cancellationToken);
        foreach (var notification in notifications)
        {
            await hub.Clients.User(notification.UserId).SendAsync("NotificationReceived", new NotificationDto(notification.Id, notification.CaseId, notification.Title, notification.Message, notification.IsRead, notification.CreatedAt), cancellationToken);
        }
        return Ok(alert);
    }

    [HttpPatch("cases/{id:int}/correct-status")]
    [Authorize(Roles = "Administrator")]
    public async Task<ActionResult<AlertDto>> CorrectCaseStatus(int id, [FromBody] CaseStatusCorrectionRequest request, CancellationToken cancellationToken)
    {
        var targetStatus = request.Status.Trim();
        var reason = request.Reason.Trim();
        if (targetStatus is not ("Active" or "FoundSafe" or "FoundDeceased"))
            return BadRequest(new { message = "Corrected status must be Active, FoundSafe or FoundDeceased." });
        if (reason.Length < 10)
            return BadRequest(new { message = "Provide a correction reason of at least 10 characters." });

        var item = await database.MissingPersonCases.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (item is null || item.ReviewStatus != "Approved")
            return NotFound(new { message = "Approved case not found." });
        if (item.CaseStatus is not ("FoundSafe" or "FoundDeceased"))
            return Conflict(new { message = "Only cases already marked Found Safe or Found Deceased can use the outcome-correction workflow." });
        if (item.CaseStatus == targetStatus)
            return BadRequest(new { message = "The case already has that status. Choose a different corrected status." });

        var administratorId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        var previousStatus = item.CaseStatus;
        item.CaseStatus = targetStatus;
        item.UpdatedAt = DateTimeOffset.UtcNow;

        // Never automatically republish old sightings after a status correction. If the case is
        // reopened, each earlier sighting must be submitted/reviewed again before it can be public.
        var relatedSightings = await database.Sightings
            .Where(s => s.CaseId == item.Id && (s.ReviewStatus == "Reviewed" || s.ReviewStatus == "Pending"))
            .ToListAsync(cancellationToken);
        foreach (var sighting in relatedSightings)
        {
            sighting.ReviewStatus = "HiddenCaseResolved";
            sighting.ReviewedAt = DateTimeOffset.UtcNow;
            sighting.ReviewedByUserId = administratorId;
        }

        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = administratorId,
            Action = "CaseStatusCorrected",
            EntityType = "MissingPersonCase",
            EntityId = item.Id.ToString(),
            Notes = $"{previousStatus} -> {targetStatus}. Reason: {reason}. {relatedSightings.Count} related sighting(s) kept hidden pending fresh review.",
            CreatedAt = DateTimeOffset.UtcNow
        });

        var areaSubscriptions = await database.AreaSubscriptions.AsNoTracking().ToListAsync(cancellationToken);
        var recipients = areaSubscriptions
            .Where(s => string.Equals(s.AreaName.Trim(), item.PublicAreaName.Trim(), StringComparison.OrdinalIgnoreCase))
            .Select(s => s.UserId)
            .Append(item.CreatedByUserId)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var correctedLabel = targetStatus switch
        {
            "Active" => "Active — person is still missing",
            "FoundSafe" => "Found Safe",
            _ => "Found Deceased"
        };
        var notifications = recipients.Select(userId => new Notification
        {
            UserId = userId,
            CaseId = item.Id,
            Title = "Case status corrected by administrator",
            Message = $"An administrator corrected the status of case {item.CaseReference} to {correctedLabel}.",
            IsRead = false,
            CreatedAt = DateTimeOffset.UtcNow
        }).ToList();
        database.Notifications.AddRange(notifications);
        await database.SaveChangesAsync(cancellationToken);

        var alert = CasesController.ToPublicAlert(item);
        await hub.Clients.All.SendAsync("CaseStatusChanged", alert, cancellationToken);
        foreach (var notification in notifications)
        {
            await hub.Clients.User(notification.UserId).SendAsync("NotificationReceived", new NotificationDto(notification.Id, notification.CaseId, notification.Title, notification.Message, notification.IsRead, notification.CreatedAt), cancellationToken);
        }
        return Ok(alert);
    }

    [HttpGet("sightings/pending")]
    public async Task<ActionResult<IReadOnlyList<SightingDto>>> GetPendingSightings(CancellationToken cancellationToken)
    {
        var sightings = await database.Sightings.AsNoTracking()
            .Include(s => s.Case)
            .Where(s => s.ReviewStatus == "Pending" && s.Case != null && s.Case.ReviewStatus == "Approved" && s.Case.CaseStatus == "Active")
            .OrderBy(s => s.CreatedAt)
            .ToListAsync(cancellationToken);
        return Ok(sightings.Select(s => new SightingDto(s.Id, s.CaseId, s.Case?.CaseReference ?? "", s.Description, s.PublicAreaName, s.SeenAt, s.IsAnonymous, s.IsAnonymous ? null : s.ContactName, s.IsAnonymous ? null : s.ContactEmail, s.ReviewStatus, s.CreatedAt)).ToList());
    }

    [HttpPost("sightings/{id:int}/approve")]
    public async Task<IActionResult> ApproveSighting(int id, CancellationToken cancellationToken)
    {
        var sighting = await database.Sightings.Include(s => s.Case).FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (sighting is null) return NotFound(new { message = "Sighting not found." });
        if (sighting.ReviewStatus != "Pending") return Conflict(new { message = "This sighting has already been reviewed." });
        if (sighting.Case is null || sighting.Case.ReviewStatus != "Approved" || sighting.Case.CaseStatus != "Active")
            return Conflict(new { message = "This sighting cannot be published because the related case is no longer an active missing-person alert." });
        var reviewerId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        sighting.ReviewStatus = "Reviewed";
        sighting.ReviewedAt = DateTimeOffset.UtcNow;
        sighting.ReviewedByUserId = reviewerId;
        database.AuditLogs.Add(new AuditLog { ActorUserId = reviewerId, Action = "SightingReviewed", EntityType = "Sighting", EntityId = id.ToString(), Notes = "Sighting checked by moderator. Review does not independently prove identity." });
        await database.SaveChangesAsync(cancellationToken);
        return Ok(new { sighting.Id, sighting.ReviewStatus, message = "Sighting marked as reviewed." });
    }

    [HttpPost("sightings/{id:int}/reject")]
    public async Task<IActionResult> RejectSighting(int id, CancellationToken cancellationToken)
    {
        var sighting = await database.Sightings.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (sighting is null) return NotFound(new { message = "Sighting not found." });
        if (sighting.ReviewStatus != "Pending") return Conflict(new { message = "This sighting has already been reviewed." });
        var reviewerId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        sighting.ReviewStatus = "Rejected";
        sighting.ReviewedAt = DateTimeOffset.UtcNow;
        sighting.ReviewedByUserId = reviewerId;
        database.AuditLogs.Add(new AuditLog { ActorUserId = reviewerId, Action = "SightingRejected", EntityType = "Sighting", EntityId = id.ToString() });
        await database.SaveChangesAsync(cancellationToken);
        return Ok(new { sighting.Id, sighting.ReviewStatus, message = "Sighting rejected." });
    }
}
