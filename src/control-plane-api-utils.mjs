export function decodeRouteParam(match, index = 1) {
  return decodeURIComponent(match[index]);
}

export function parseRequestUrl(request, baseUrl = "http://localhost") {
  return new URL(request.url || "/", baseUrl);
}

export function pickRequestSearchParams(request, names) {
  const searchParams = parseRequestUrl(request).searchParams;
  return Object.fromEntries(names.map((name) => [name, searchParams.get(name)]));
}
