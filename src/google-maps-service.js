class MapsServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createGoogleMapsService({ apiKey, countryCode = "PH", fetchImpl = fetch } = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const country = typeof countryCode === "string" ? countryCode.toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("GOOGLE_MAPS_COUNTRY must be a two-letter country code.");
  }

  return {
    isConfigured: Boolean(key),
    async geocode(address) {
      if (!key) {
        throw new MapsServiceError(503, "Google Maps geocoding is not configured on this server.");
      }

      const endpoint = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      endpoint.searchParams.set("address", address);
      endpoint.searchParams.set("components", `country:${country}`);
      endpoint.searchParams.set("key", key);

      let response;
      try {
        response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(8000) });
      } catch (error) {
        if (error.name === "TimeoutError" || error.name === "AbortError") {
          throw new MapsServiceError(504, "Google Maps geocoding took too long. Please try again.");
        }
        throw new MapsServiceError(502, "Google Maps geocoding is temporarily unavailable.");
      }
      if (!response.ok) {
        throw new MapsServiceError(502, "Google Maps geocoding is temporarily unavailable.");
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new MapsServiceError(502, "Google Maps returned an unreadable response.");
      }

      if (result.status === "ZERO_RESULTS") {
        throw new MapsServiceError(404, "Google Maps could not find that address.");
      }
      if (result.status === "OVER_QUERY_LIMIT") {
        throw new MapsServiceError(429, "Google Maps geocoding quota has been reached. Please try later.");
      }
      if (result.status !== "OK") {
        throw new MapsServiceError(503, "Google Maps geocoding is unavailable. Check the server key and API access.");
      }

      const place = result.results?.[0];
      const latitude = place?.geometry?.location?.lat;
      const longitude = place?.geometry?.location?.lng;
      if (!place || typeof place.formatted_address !== "string" ||
          !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
          !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new MapsServiceError(502, "Google Maps returned an invalid location.");
      }

      return {
        formattedAddress: place.formatted_address,
        latitude,
        longitude,
        placeId: place.place_id
      };
    }
  };
}

module.exports = { MapsServiceError, createGoogleMapsService };
