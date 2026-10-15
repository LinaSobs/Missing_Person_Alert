using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MissingPersonAlert.Api.Models;

namespace MissingPersonAlert.Api.Data;

public static class DatabaseSeeder
{
    private static readonly string[] Roles =
    [
        "Member",
        "Reporter",
        "Moderator",
        "Administrator"
    ];

    public static async Task InitializeAsync(
        IServiceProvider services,
        IConfiguration configuration)
    {
        using var scope = services.CreateScope();

        var database = scope.ServiceProvider
            .GetRequiredService<MissingPersonAlertDbContext>();

        // Create the database if it does not already exist.
        await database.Database.EnsureCreatedAsync();

        // Ensure older local coursework databases have the optional
        // sighting map-coordinate and contact-publication columns.
        // These statements do nothing when the columns already exist.
        await database.Database.ExecuteSqlRawAsync("""
            IF OBJECT_ID(N'dbo.Sightings', N'U') IS NOT NULL
                AND COL_LENGTH(N'dbo.Sightings', N'SightingLatitude') IS NULL
                ALTER TABLE dbo.Sightings ADD SightingLatitude float NULL;

            IF OBJECT_ID(N'dbo.Sightings', N'U') IS NOT NULL
                AND COL_LENGTH(N'dbo.Sightings', N'SightingLongitude') IS NULL
                ALTER TABLE dbo.Sightings ADD SightingLongitude float NULL;

            IF OBJECT_ID(N'dbo.MissingPersonCases', N'U') IS NOT NULL
                AND COL_LENGTH(N'dbo.MissingPersonCases', N'PublishContactDetails') IS NULL
                ALTER TABLE dbo.MissingPersonCases
                ADD PublishContactDetails bit NOT NULL
                CONSTRAINT DF_MissingPersonCases_PublishContactDetails
                DEFAULT (0);
            """);

        // Create application roles when they do not already exist.
        var roleManager = scope.ServiceProvider
            .GetRequiredService<RoleManager<IdentityRole>>();

        foreach (var role in Roles)
        {
            if (!await roleManager.RoleExistsAsync(role))
            {
                var result = await roleManager.CreateAsync(
                    new IdentityRole(role));

                if (!result.Succeeded)
                {
                    throw new InvalidOperationException(
                        $"Could not create role {role}: " +
                        string.Join(
                            ", ",
                            result.Errors.Select(error => error.Description)));
                }
            }
        }

        // Administrator account creation is disabled unless explicitly enabled
        // through configuration or environment variables.
        if (!configuration.GetValue<bool>("SeedAdmin:Enabled"))
        {
            return;
        }

        var email = configuration["SeedAdmin:Email"];
        var password = configuration["SeedAdmin:Password"];

        if (string.IsNullOrWhiteSpace(email) ||
            string.IsNullOrWhiteSpace(password))
        {
            throw new InvalidOperationException(
                "SeedAdmin is enabled but its email or password is missing.");
        }

        var userManager = scope.ServiceProvider
            .GetRequiredService<UserManager<AppUser>>();

        var admin = await userManager.FindByEmailAsync(email);

        if (admin is null)
        {
            admin = new AppUser
            {
                UserName = email,
                Email = email,
                DisplayName = "Missing Person Alert Administrator",
                EmailConfirmed = true
            };

            var created = await userManager.CreateAsync(admin, password);

            if (!created.Succeeded)
            {
                throw new InvalidOperationException(
                    "Could not create the configured administrator: " +
                    string.Join(
                        ", ",
                        created.Errors.Select(error => error.Description)));
            }
        }

        // Ensure the configured account has the Administrator role.
        if (!await userManager.IsInRoleAsync(admin, "Administrator"))
        {
            var roleResult = await userManager.AddToRoleAsync(
                admin,
                "Administrator");

            if (!roleResult.Succeeded)
            {
                throw new InvalidOperationException(
                    "Could not assign the Administrator role: " +
                    string.Join(
                        ", ",
                        roleResult.Errors.Select(error => error.Description)));
            }
        }

        // Disable the old development moderator account if it exists.
        // This prevents outdated starter credentials from remaining usable.
        var legacyModerator = await userManager.FindByEmailAsync(
            "moderator@missingpersonalert.local");

        if (legacyModerator is not null &&
            !string.Equals(
                legacyModerator.Email,
                email,
                StringComparison.OrdinalIgnoreCase))
        {
            if (await userManager.IsInRoleAsync(
                    legacyModerator, "Moderator"))
            {
                await userManager.RemoveFromRoleAsync(
                    legacyModerator, "Moderator");
            }

            if (!legacyModerator.LockoutEnabled)
            {
                await userManager.SetLockoutEnabledAsync(
                    legacyModerator, true);
            }

            await userManager.SetLockoutEndDateAsync(
                legacyModerator, DateTimeOffset.MaxValue);
        }
    }
}