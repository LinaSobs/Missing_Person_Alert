using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;
using MissingPersonAlert.Api.DTOs;
using MissingPersonAlert.Api.Models;

namespace MissingPersonAlert.Api.Services;

public sealed class TokenService(IConfiguration configuration, UserManager<AppUser> userManager)
{
    public async Task<AuthResponse> CreateResponseAsync(AppUser user)
    {
        var issuer = configuration["Jwt:Issuer"] ?? "MissingPersonAlert.Api";
        var audience = configuration["Jwt:Audience"] ?? "MissingPersonAlert.Frontend";
        var secret = configuration["Jwt:SigningKey"] ?? throw new InvalidOperationException("JWT signing key is not configured.");
        var roles = await userManager.GetRolesAsync(user);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id),
            new(ClaimTypes.NameIdentifier, user.Id),
            new(ClaimTypes.Name, user.DisplayName),
            new(ClaimTypes.Email, user.Email ?? string.Empty),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(issuer, audience, claims, expires: DateTime.UtcNow.AddHours(4), signingCredentials: credentials);
        return new AuthResponse(new JwtSecurityTokenHandler().WriteToken(token), new UserDto(user.Id, user.DisplayName, user.Email ?? string.Empty, roles.ToList()));
    }
}
