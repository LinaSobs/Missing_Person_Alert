namespace MissingPersonAlert.Api.Models;

public sealed class MissingPersonCase
{
    public int Id { get; set; }
    public string CaseReference { get; set; } = string.Empty;
    public string PersonName { get; set; } = string.Empty;
    public int AgeAtDisappearance { get; set; }
    public string Description { get; set; } = string.Empty;
    public string? ClothingDescription { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public double? LastSeenLatitude { get; set; }
    public double? LastSeenLongitude { get; set; }
    public string PublicAreaName { get; set; } = string.Empty;
    public string ContactName { get; set; } = string.Empty;
    public string ContactPhone { get; set; } = string.Empty;
    public string ContactEmail { get; set; } = string.Empty;
    public bool PublishContactDetails { get; set; }
    public string? Circumstances { get; set; }
    public string? PhotoStorageKey { get; set; }
    public string? PhotoContentType { get; set; }
    public string ReviewStatus { get; set; } = "Pending";
    public string CaseStatus { get; set; } = "Active";
    public string CreatedByUserId { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ReviewedAt { get; set; }
    public string? ReviewedByUserId { get; set; }
    public string? ModerationReason { get; set; }
}
