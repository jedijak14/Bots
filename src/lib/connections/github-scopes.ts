/** Never accept an OAuth grant broader than the read-only scope requested. */
export function githubScopesAreSafe(scope: unknown): boolean {
  if (typeof scope !== "string") return false;
  const scopes = scope.split(/[ ,]+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((s) => s === "read:user");
}
