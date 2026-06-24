export function decodeRouteParam(match, index = 1) {
  return decodeURIComponent(match[index]);
}

export function pickRequestSearchParams(request, names) {
  const searchParams = new URL(request.url || "/", "http://localhost").searchParams;
  return Object.fromEntries(names.map((name) => [name, searchParams.get(name)]));
}
