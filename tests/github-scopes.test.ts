import { strict as assert } from "node:assert";
import { test } from "node:test";
import { githubScopesAreSafe } from "../src/lib/connections/github-scopes";
test("GitHub OAuth rejects missing or broader grants", () => {
  assert.equal(githubScopesAreSafe("read:user"), true);
  for (const scope of [undefined, "", "repo", "read:user,repo", "read:user user", "read:user,delete_repo"]) assert.equal(githubScopesAreSafe(scope), false);
});
