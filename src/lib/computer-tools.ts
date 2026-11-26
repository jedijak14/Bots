/** Only these tools require the Bot's computer panel; other tools run elsewhere. */
const COMPUTER_TOOL_NAMES = new Set([
  "run_command", "build_toolchain", "web_search", "fetch_page", "open_url", "write_file", "read_file", "click", "type_text", "press_key",
]);
export function usesComputer(name: string): boolean { return COMPUTER_TOOL_NAMES.has(name); }
