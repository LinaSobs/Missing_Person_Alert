namespace MissingPersonAlert.Api.Models;

public sealed class Sighting
{
    public int Id { get; set; }
    public int CaseId { get; set; }
    public MissingPersonCase? Case { get; set; }
    public string Description { get; set; } = string.Empty;
    public string PublicAreaName { get; set; } = string.Empty;
    public double? SightingLatitude { get; set; }
    public double? SightingLongitude { get; set; }
    public DateTimeOffset SeenAt { get; set; }
    public bool IsAnonymous { get; set; }
    public string? ContactName { get; set; }
    public string? ContactEmail { get; set; }
    public string? ReporterUserId { get; set; }
    public string ReviewStatus { get; set; } = "Pending";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ReviewedAt { get; set; }
    public string? ReviewedByUserId { get; set; }
}
