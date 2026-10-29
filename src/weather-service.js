class WeatherServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const conditions = {
  0: "Clear sky",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Icy fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm with hail"
};

function createWeatherService({ fetchImpl = fetch } = {}) {
  const cache = new Map();

  return {
    async current(latitude, longitude) {
      const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) return cached.weather;

      const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
      endpoint.searchParams.set("latitude", String(latitude));
      endpoint.searchParams.set("longitude", String(longitude));
      endpoint.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m");
      endpoint.searchParams.set("timezone", "auto");
      endpoint.searchParams.set("temperature_unit", "celsius");

      let response;
      try {
        response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(8000) });
      } catch (error) {
        if (error.name === "TimeoutError" || error.name === "AbortError") {
          throw new WeatherServiceError(504, "Weather is taking longer than expected. Please try again.");
        }
        throw new WeatherServiceError(502, "Weather is temporarily unavailable.");
      }
      if (!response.ok) throw new WeatherServiceError(502, "Weather is temporarily unavailable.");

      let result;
      try {
        result = await response.json();
      } catch {
        throw new WeatherServiceError(502, "The weather service returned an unreadable response.");
      }

      const current = result.current;
      if (!current || !Number.isFinite(current.temperature_2m) ||
          !Number.isFinite(current.apparent_temperature) ||
          !Number.isFinite(current.weather_code)) {
        throw new WeatherServiceError(502, "The weather service did not return current conditions.");
      }

      const feelsLike = Math.round(current.apparent_temperature);
      const weather = {
        temperatureC: Math.round(current.temperature_2m),
        feelsLikeC: feelsLike,
        humidityPercent: Number.isFinite(current.relative_humidity_2m)
          ? Math.round(current.relative_humidity_2m)
          : null,
        windKph: Number.isFinite(current.wind_speed_10m)
          ? Math.round(current.wind_speed_10m)
          : null,
        condition: conditions[current.weather_code] || "Current conditions",
        comfort: feelsLike >= 32 ? "hot" : feelsLike >= 27 ? "warm" : feelsLike <= 10 ? "cold" : feelsLike <= 18 ? "cool" : "comfortable",
        advice: feelsLike >= 32
          ? "It feels hot—drink water and take breaks in the shade."
          : feelsLike >= 27
            ? "It feels warm—light clothing and water may help."
            : feelsLike <= 10
              ? "It feels cold—bring a warm layer before heading out."
              : feelsLike <= 18
              ? "It feels cool—consider bringing a light layer."
              : "Conditions feel comfortable for heading out.",
        observedAt: typeof current.time === "string" ? current.time : null,
        source: "Open-Meteo"
      };

      if (cache.size >= 200) {
        for (const [cacheKey, entry] of cache) {
          if (entry.expiresAt <= now || cache.size >= 150) cache.delete(cacheKey);
        }
      }
      cache.set(key, { weather, expiresAt: now + 5 * 60_000 });
      return weather;
    }
  };
}

module.exports = { WeatherServiceError, createWeatherService };
