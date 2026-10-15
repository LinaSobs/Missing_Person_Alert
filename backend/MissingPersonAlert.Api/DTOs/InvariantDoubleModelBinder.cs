using System.Globalization;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace MissingPersonAlert.Api.DTOs;

/// <summary>
/// Parses numeric form fields using invariant culture. Coordinates are submitted
/// by the browser with a period as the decimal separator, regardless of the
/// Windows regional settings of the machine running the API.
/// </summary>
public sealed class InvariantDoubleModelBinder : IModelBinder
{
    public Task BindModelAsync(ModelBindingContext bindingContext)
    {
        ArgumentNullException.ThrowIfNull(bindingContext);

        var valueResult = bindingContext.ValueProvider.GetValue(bindingContext.ModelName);
        if (valueResult == ValueProviderResult.None)
            return Task.CompletedTask;

        bindingContext.ModelState.SetModelValue(bindingContext.ModelName, valueResult);
        var rawValue = valueResult.FirstValue;

        if (string.IsNullOrWhiteSpace(rawValue))
        {
            bindingContext.Result = ModelBindingResult.Success(null);
            return Task.CompletedTask;
        }

        if (double.TryParse(rawValue, NumberStyles.Float, CultureInfo.InvariantCulture, out var coordinate)
            && double.IsFinite(coordinate))
        {
            bindingContext.Result = ModelBindingResult.Success(coordinate);
            return Task.CompletedTask;
        }

        bindingContext.ModelState.TryAddModelError(
            bindingContext.ModelName,
            $"The value '{rawValue}' is not a valid numeric coordinate.");
        return Task.CompletedTask;
    }
}
