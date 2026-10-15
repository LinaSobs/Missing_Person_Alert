using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MissingPersonAlert.Api.DTOs;
using MissingPersonAlert.Api.Data;
using MissingPersonAlert.Api.Models;
using MissingPersonAlert.Api.Services;

namespace MissingPersonAlert.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(UserManager<AppUser> userManager, SignInManager<AppUser> signInManager, TokenService tokenService, MissingPersonAlertDbContext database) : ControllerBase
{
    [HttpPost("register")]
    [ProducesResponseType<AuthResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = new AppUser
        {
            UserName = email,
            Email = email,
            DisplayName = request.DisplayName.Trim(),
            CreatedAt = DateTimeOffset.UtcNow
        };

        var result = await userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
            return BadRequest(new { message = string.Join(" ", result.Errors.Select(e => e.Description)) });

        await userManager.AddToRoleAsync(user, "Member");
        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = user.Id, Action = "AccountRegistered", EntityType = "User", EntityId = user.Id,
            Notes = "Member account registered.", CreatedAt = DateTimeOffset.UtcNow
        });
        await database.SaveChangesAsync();
        return Ok(await tokenService.CreateResponseAsync(user));
    }

    [HttpPost("login")]
    [ProducesResponseType<AuthResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var user = await userManager.FindByEmailAsync(request.Email.Trim());
        if (user is null)
            return Unauthorized(new { message = "Incorrect password or email." });
        var signInResult = await signInManager.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true);
        if (signInResult.IsLockedOut)
            return Unauthorized(new { message = "This account is temporarily locked. Try again later." });
        if (!signInResult.Succeeded)
            return Unauthorized(new { message = "Incorrect password or email." });

        database.AuditLogs.Add(new AuditLog
        {
            ActorUserId = user.Id, Action = "UserSignedIn", EntityType = "User", EntityId = user.Id,
            Notes = "Successful sign-in.", CreatedAt = DateTimeOffset.UtcNow
        });
        await database.SaveChangesAsync();
        return Ok(await tokenService.CreateResponseAsync(user));
    }
}
