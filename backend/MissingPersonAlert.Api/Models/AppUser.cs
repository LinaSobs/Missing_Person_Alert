using Microsoft.AspNetCore.Identity;

namespace MissingPersonAlert.Api.Models;

public sealed class AppUser : IdentityUser
{
    public string DisplayName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
