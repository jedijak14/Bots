import { test } from "node:test";
import { strict as assert } from "node:assert";
import { historyExcerpt, historyPage } from "../src/lib/history";

test("search excerpt includes a match deep inside a saved artifact", () => {
  const content = "intro ".repeat(1000) + "The Sapphire Castle" + " conclusion".repeat(500);
  const excerpt = historyExcerpt(content, "sapphire castle", 50);
  assert.ok(excerpt.includes("The Sapphire Castle"));
  assert.ok(excerpt.length < 140);
  assert.ok(excerpt.startsWith("…") && excerpt.endsWith("…"));
});

test("saved artifacts can be read in bounded pages without losing text", () => {
  const original = "long story ".repeat(2000);
  let offset: number | null = 0;
  let result = "";
  while (offset !== null) {
    const page: ReturnType<typeof historyPage> = historyPage(original, offset);
    result += page.content;
    offset = page.nextOffset;
  }
  assert.equal(result, original);
  assert.equal(historyPage("short", 0).nextOffset, null);
});
