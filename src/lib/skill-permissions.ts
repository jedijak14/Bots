export const SKILL_TOOL_OPTIONS = [
  { id: "save_artifact", label: "Save artifacts" },
  { id: "draft_email", label: "Draft email" },
  { id: "search_gmail", label: "Search Gmail" },
  { id: "search_youtube", label: "Search YouTube" },
  { id: "search_notion", label: "Search Notion" },
  { id: "list_github_repositories", label: "List GitHub repositories" },
  { id: "list_vercel_projects", label: "List Vercel projects" },
  { id: "list_saved_spotify_tracks", label: "List saved Spotify tracks" },
  { id: "get_current_time", label: "Get current time" },
  { id: "run_command", label: "Run computer commands" },
  { id: "web_search", label: "Search the web" },
  { id: "fetch_page", label: "Read web pages" },
  { id: "open_url", label: "Open browser URLs" },
  { id: "write_file", label: "Write computer files" },
  { id: "read_file", label: "Read computer files" },
  { id: "click", label: "Click in the computer" },
  { id: "type_text", label: "Type in the computer" },
  { id: "press_key", label: "Press computer keys" },
] as const;

export const SKILL_CONNECTOR_OPTIONS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "notion", label: "Notion" },
  { id: "vercel", label: "Vercel" },
  { id: "spotify", label: "Spotify" },
] as const;

export const TOOL_CONNECTOR: Record<string, string> = {
  search_gmail: "google",
  search_youtube: "google",
  search_notion: "notion",
  list_github_repositories: "github",
  list_vercel_projects: "vercel",
  list_saved_spotify_tracks: "spotify",
};

const toolIds = new Set<string>(SKILL_TOOL_OPTIONS.map((item) => item.id));
const connectorIds = new Set<string>(SKILL_CONNECTOR_OPTIONS.map((item) => item.id));

export function normalizePermissionIds(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))];
}

export function normalizeSkillTools(value: unknown) {
  return normalizePermissionIds(value, toolIds);
}

export function normalizeSkillConnectors(value: unknown) {
  return normalizePermissionIds(value, connectorIds);
}
