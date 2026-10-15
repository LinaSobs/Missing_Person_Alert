using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MissingPersonAlert.Api.Data;
using MissingPersonAlert.Api.DTOs;

namespace MissingPersonAlert.Api.Controllers;

[ApiController]
[Route("api/notifications")]
[Authorize]
public sealed class NotificationsController(MissingPersonAlertDbContext database) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<NotificationDto>>> GetMine(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var items = await database.Notifications.AsNoTracking()
            .Where(n => n.UserId == userId)
            .OrderByDescending(n => n.CreatedAt)
            .Take(100)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(n => new NotificationDto(n.Id, n.CaseId, n.Title, n.Message, n.IsRead, n.CreatedAt)).ToList());
    }

    [HttpPost("{id:int}/read")]
    public async Task<IActionResult> MarkRead(int id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var item = await database.Notifications.FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId, cancellationToken);
        if (item is null) return NotFound(new { message = "Notification not found." });
        item.IsRead = true;
        await database.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}
