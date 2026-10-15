namespace MissingPersonAlert.Api.Models;

public sealed class AreaSubscription
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string AreaName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
