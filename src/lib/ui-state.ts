/**
 * Small pieces of interface state that the server needs to know about before
 * the first paint. Kept in a plain module so both server and client can import it.
 */

/** Cookie remembering whether the sidebar is collapsed to its icon rail ("collapsed" | "open"). */
export const SIDEBAR_COOKIE = "sidebar";
