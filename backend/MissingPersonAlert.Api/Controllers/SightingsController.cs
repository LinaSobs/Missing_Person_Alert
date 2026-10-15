using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MissingPersonAlert.Api.Data;
using MissingPersonAlert.Api.DTOs;
using MissingPersonAlert.Api.Models;

namespace MissingPersonAlert.Api.Controllers;

[ApiController]
[Route("api/sightings")]
public sealed class SightingsController(MissingPersonAlertDbContext database) : ControllerBase
{
    [HttpGet("public")]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<PublicSightingDto>>> GetPublicSightings(CancellationToken cancellationToken)
    {
        var sightings = await database.Sightings.AsNoTracking()
            .Include(s => s.Case)
            .Where(s => s.ReviewStatus == "Reviewed" && s.Case != null && s.Case.ReviewStatus == "Approved" && s.Case.CaseStatus == "Active")
            .OrderByDescending(s => s.SeenAt)
            .ToListAsync(cancellationToken);

        var response = sightings.Select(s => new PublicSightingDto(
            s.Id, s.CaseId, s.Case!.CaseReference, s.Case.PersonName, s.Description, s.PublicAreaName, s.SeenAt, s.ReviewStatus,
            s.SightingLatitude.HasValue ? Math.Round(s.SightingLatitude.Value, 2) : null,
            s.SightingLongitude.HasValue ? Math.Round(s.SightingLongitude.Value, 2) : null)).ToList();
        return Ok(response);
    }

    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting("tips")]
    public async Task<ActionResult<object>> Create([FromBody] CreateSightingRequest request, CancellationToken cancellationToken)
    {
        if (request.SeenAt!.Value > DateTimeOffset.UtcNow)
            return BadRequest(new { message = "Sighting date and time cannot be in the future." });
        if (!request.SightingLatitude.HasValue || !request.SightingLongitude.HasValue)
            return BadRequest(new { message = "Select an approximate sighting location so the reviewed sighting can appear on the map." });

        var relatedCase = await database.MissingPersonCases.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == request.CaseId && c.ReviewStatus == "Approved" && c.CaseStatus == "Active", cancellationToken);
        if (relatedCase is null)
            return BadRequest(new { message = "Select an active, approved public alert." });

        var sighting = new Sighting
        {
            CaseId = relatedCase.Id,
            Description = request.Description.Trim(),
            PublicAreaName = request.PublicAreaName.Trim(),
            SightingLatitude = request.SightingLatitude,
            SightingLongitude = request.SightingLongitude,
            SeenAt = request.SeenAt.Value,
            IsAnonymous = request.IsAnonymous,
            ContactName = request.IsAnonymous ? null : string.IsNullOrWhiteSpace(request.ContactName) ? null : request.ContactName.Trim(),
            ContactEmail = request.IsAnonymous ? null : string.IsNullOrWhiteSpace(request.ContactEmail) ? null : request.ContactEmail.Trim(),
            ReporterUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
            ReviewStatus = "Pending",
            CreatedAt = DateTimeOffset.UtcNow
        };
        database.Sightings.Add(sighting);
        await database.SaveChangesAsync(cancellationToken);
        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = sighting.ReporterUserId ?? "anonymous",
            Action = "SightingSubmitted",
            EntityType = "Sighting",
            EntityId = sighting.Id.ToString(),
            Notes = $"Possible sighting submitted for review for case {relatedCase.CaseReference}; contact details omitted from audit record.",
            CreatedAt = DateTimeOffset.UtcNow
        });
        await database.SaveChangesAsync(cancellationToken);
        return Accepted(new { sighting.Id, sighting.ReviewStatus, message = "Sighting received for review. It is not public and does not confirm that the person has been found." });
    }
}
