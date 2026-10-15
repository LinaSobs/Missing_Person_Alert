using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace MissingPersonAlert.Api.Hubs;

[Authorize]
public sealed class AlertHub : Hub
{
    // Clients receive events only after authenticating. Public alert data still comes from the read-only API.
}
