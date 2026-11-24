/**
 * Fitting a conversation into a context window without losing its shape.
 *
 * Counting messages is a poor proxy for cost: two long documents and forty
 * short replies can hold the same number of entries and wildly different
 * amounts of text. This keeps the newest messages verbatim, trims oversized
 * ones in the middle, and stops adding once it reaches the budget — so the
 * model sees recent context at full fidelity and older context at all, rather
 * than a truncated wall that pushes the actual question out of the window.
 */

/** ~4 characters per token is the usual English estimate. */
const CHARS_PER_TOKEN = 4;

export type BudgetedMessage = { role: "user" | "assistant"; content: string };

/**
 * @param messages newest last
 * @param maxTokens total characters budget, in tokens
 */
export function fitHistory(messages: BudgetedMessage[], maxTokens = 24_000): BudgetedMessage[] {
  const budget = maxTokens * CHARS_PER_TOKEN;
  const kept: BudgetedMessage[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const remaining = budget - used;
    if (remaining <= 0) break;

    let content = message.content;
    if (content.length > remaining) {
      // The newest message is the question itself, so it keeps a generous
      // slice even when the budget is nearly spent; older ones get what is left.
      const room = kept.length === 0 ? Math.max(remaining, Math.floor(budget * 0.35)) : remaining;
      content = `${content.slice(0, room).trimEnd()}\n\n[…truncated]`;
    }

    kept.push({ role: message.role, content });
    used += content.length;
  }

  return kept.reverse();
}
