/**
 * Id checks for route params.
 *
 * Every id in this app is a Postgres `uuid`. Passing any other string straight
 * into a query does not return "no rows" — Postgres raises 22P02 ("invalid
 * input syntax for type uuid") and the route answers 500. A request for an
 * artifact that does not exist is a 404; a malformed one is a typo, not a
 * server fault.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
