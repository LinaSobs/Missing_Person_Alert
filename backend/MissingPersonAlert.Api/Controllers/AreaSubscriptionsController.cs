using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MissingPersonAlert.Api.Data;
using MissingPersonAlert.Api.DTOs;
using MissingPersonAlert.Api.Models;

namespace MissingPersonAlert.Api.Controllers;

[ApiController]
[Route("api/subscriptions")]
[Authorize]
public sealed class AreaSubscriptionsController(MissingPersonAlertDbContext database) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AreaSubscriptionDto>>> GetMine(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var items = await database.AreaSubscriptions.AsNoTracking().Where(s => s.UserId == userId).OrderBy(s => s.AreaName).ToListAsync(cancellationToken);
        return Ok(items.Select(s => new AreaSubscriptionDto(s.Id, s.AreaName, s.CreatedAt)).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<AreaSubscriptionDto>> Create(CreateAreaSubscriptionRequest request, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();
        var area = request.AreaName.Trim();
        var existing = await database.AreaSubscriptions.FirstOrDefaultAsync(s => s.UserId == userId && s.AreaName.ToLower() == area.ToLower(), cancellationToken);
        if (existing is not null) return Ok(new AreaSubscriptionDto(existing.Id, existing.AreaName, existing.CreatedAt));
        var subscription = new AreaSubscription { UserId = userId, AreaName = area, CreatedAt = DateTimeOffset.UtcNow };
        database.AreaSubscriptions.Add(subscription);
        await database.SaveChangesAsync(cancellationToken);
        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = userId, Action = "AreaSubscriptionCreated", EntityType = "AreaSubscription",
            EntityId = subscription.Id.ToString(), Notes = $"Subscribed to area: {area}.", CreatedAt = DateTimeOffset.UtcNow
        });
        await database.SaveChangesAsync(cancellationToken);
        return Ok(new AreaSubscriptionDto(subscription.Id, subscription.AreaName, subscription.CreatedAt));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var item = await database.AreaSubscriptions.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId, cancellationToken);
        if (item is null) return NotFound(new { message = "Subscription not found." });
        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = userId ?? "unknown", Action = "AreaSubscriptionDeleted", EntityType = "AreaSubscription",
            EntityId = item.Id.ToString(), Notes = $"Unsubscribed from area: {item.AreaName}.", CreatedAt = DateTimeOffset.UtcNow
        });
        database.AreaSubscriptions.Remove(item);
        await database.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}
