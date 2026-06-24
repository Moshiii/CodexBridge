export function pickRequestSearchParams(request, names) {
  const searchParams = new URL(request.url || "/", "http://localhost").searchParams;
  return Object.fromEntries(names.map((name) => [name, searchParams.get(name)]));
}
