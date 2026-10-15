namespace MissingPersonAlert.Api.Models;

public sealed class Notification
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public int? CaseId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public bool IsRead { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
