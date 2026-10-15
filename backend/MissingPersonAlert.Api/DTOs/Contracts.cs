using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;

namespace MissingPersonAlert.Api.DTOs;

public sealed class RegisterRequest
{
    [Required, StringLength(100, MinimumLength = 2)] public string DisplayName { get; set; } = string.Empty;
    [Required, EmailAddress, StringLength(254)] public string Email { get; set; } = string.Empty;
    [Required, StringLength(100, MinimumLength = 8)] public string Password { get; set; } = string.Empty;
}

public sealed class LoginRequest
{
    [Required, EmailAddress, StringLength(254)] public string Email { get; set; } = string.Empty;
    [Required, StringLength(100, MinimumLength = 8)] public string Password { get; set; } = string.Empty;
}

public sealed record UserDto(string Id, string DisplayName, string Email, IReadOnlyList<string> Roles);
public sealed record AuthResponse(string Token, UserDto User);

public sealed class CreateMissingPersonRequest
{
    [Required, StringLength(120, MinimumLength = 2)] public string PersonName { get; set; } = string.Empty;
    [Range(0, 120)] public int AgeAtDisappearance { get; set; }
    [Required, StringLength(2000, MinimumLength = 10)] public string Description { get; set; } = string.Empty;
    [StringLength(300)] public string? ClothingDescription { get; set; }
    [Required] public DateTimeOffset? LastSeenAt { get; set; }
    [ModelBinder(BinderType = typeof(InvariantDoubleModelBinder)), Range(-90, 90)] public double? LastSeenLatitude { get; set; }
    [ModelBinder(BinderType = typeof(InvariantDoubleModelBinder)), Range(-180, 180)] public double? LastSeenLongitude { get; set; }
    [Required, StringLength(150, MinimumLength = 2)] public string PublicAreaName { get; set; } = string.Empty;
    [Required, StringLength(120, MinimumLength = 2)] public string ContactName { get; set; } = string.Empty;
    [Required(ErrorMessage = "Contact phone is required."), Phone, StringLength(30)] public string ContactPhone { get; set; } = string.Empty;
    [Required(ErrorMessage = "Contact email is required."), EmailAddress(ErrorMessage = "Enter a valid contact email address."), StringLength(254)] public string ContactEmail { get; set; } = string.Empty;
    public bool PublishContactDetails { get; set; }
    [StringLength(1500)] public string? Circumstances { get; set; }
    public bool ConfirmsRightToShare { get; set; }
    public IFormFile? Photo { get; set; }
}

public sealed record AlertDto(
    int Id,
    string CaseReference,
    string PersonName,
    int AgeAtDisappearance,
    string Description,
    string? ClothingDescription,
    DateTimeOffset LastSeenAt,
    string PublicAreaName,
    bool PublishContactDetails,
    string? ContactName,
    string? ContactPhone,
    string? ContactEmail,
    double? PublicLatitude,
    double? PublicLongitude,
    string? PhotoUrl,
    string ReviewStatus,
    string CaseStatus,
    DateTimeOffset CreatedAt);

public sealed record MyCaseDto(
    int Id,
    string CaseReference,
    string PersonName,
    int AgeAtDisappearance,
    string Description,
    string? ClothingDescription,
    DateTimeOffset LastSeenAt,
    string PublicAreaName,
    string? ContactName,
    string? ContactPhone,
    string? ContactEmail,
    bool PublishContactDetails,
    string? Circumstances,
    double? LastSeenLatitude,
    double? LastSeenLongitude,
    string? PhotoUrl,
    string ReviewStatus,
    string CaseStatus,
    string? ModerationReason,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ModeratorCaseDto(
    int Id,
    string CaseReference,
    string PersonName,
    int AgeAtDisappearance,
    string Description,
    string? ClothingDescription,
    DateTimeOffset LastSeenAt,
    string PublicAreaName,
    string ContactName,
    string? ContactPhone,
    string? ContactEmail,
    bool PublishContactDetails,
    string? Circumstances,
    string? PhotoUrl,
    string ReviewStatus,
    string CaseStatus,
    DateTimeOffset CreatedAt);

public sealed class CreateSightingRequest
{
    // Explicit JSON names keep the React payload and API contract aligned even if
    // serializer naming defaults are changed elsewhere in the application.
    [JsonPropertyName("caseId"), Range(1, int.MaxValue)] public int CaseId { get; set; }
    [JsonPropertyName("description"), Required, StringLength(2000, MinimumLength = 10)] public string Description { get; set; } = string.Empty;
    [JsonPropertyName("publicAreaName"), Required, StringLength(150, MinimumLength = 2)] public string PublicAreaName { get; set; } = string.Empty;
    [JsonPropertyName("seenAt"), Required] public DateTimeOffset? SeenAt { get; set; }
    [JsonPropertyName("sightingLatitude"), ModelBinder(BinderType = typeof(InvariantDoubleModelBinder)), Range(-90, 90)] public double? SightingLatitude { get; set; }
    [JsonPropertyName("sightingLongitude"), ModelBinder(BinderType = typeof(InvariantDoubleModelBinder)), Range(-180, 180)] public double? SightingLongitude { get; set; }
    [JsonPropertyName("isAnonymous")] public bool IsAnonymous { get; set; }
    [JsonPropertyName("contactName"), StringLength(120)] public string? ContactName { get; set; }
    [JsonPropertyName("contactEmail"), EmailAddress, StringLength(254)] public string? ContactEmail { get; set; }
}

public sealed record SightingDto(
    int Id,
    int CaseId,
    string CaseReference,
    string Description,
    string PublicAreaName,
    DateTimeOffset SeenAt,
    bool IsAnonymous,
    string? ContactName,
    string? ContactEmail,
    string ReviewStatus,
    DateTimeOffset CreatedAt);

public sealed class ReviewReasonRequest
{
    [StringLength(500)] public string? Reason { get; set; }
}

public sealed class CaseStatusUpdateRequest
{
    [Required] public string Status { get; set; } = string.Empty;
}

public sealed class CaseStatusCorrectionRequest
{
    [Required, StringLength(30)] public string Status { get; set; } = string.Empty;
    [Required, StringLength(500, MinimumLength = 10)] public string Reason { get; set; } = string.Empty;
}

public sealed class CreateAreaSubscriptionRequest
{
    [Required, StringLength(150, MinimumLength = 2)] public string AreaName { get; set; } = string.Empty;
}

public sealed record AreaSubscriptionDto(int Id, string AreaName, DateTimeOffset CreatedAt);
public sealed record NotificationDto(int Id, int? CaseId, string Title, string Message, bool IsRead, DateTimeOffset CreatedAt);
public sealed record SimpleMessage(string Message);

public sealed record PublicSightingDto(
    int Id,
    int CaseId,
    string CaseReference,
    string PersonName,
    string Description,
    string PublicAreaName,
    DateTimeOffset SeenAt,
    string ReviewStatus,
    double? PublicLatitude,
    double? PublicLongitude);

public sealed record AuditTrailEntryDto(
    long Id,
    string ActorUserId,
    string ActorDisplayName,
    string? ActorEmail,
    string Action,
    string EntityType,
    string EntityId,
    string? EntityLabel,
    string? Notes,
    DateTimeOffset CreatedAt);

public sealed record AuditTrailPageDto(
    IReadOnlyList<AuditTrailEntryDto> Items,
    int Total,
    int Skip,
    int Take);
