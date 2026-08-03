import type { Conversation, OtherwiseOptions } from "@grammyjs/conversations";
import type { Filter, FilterQuery } from "grammy";
import type { MyContext } from "../instance";

export const CANCEL_COMMAND = "/cancel";

/** Thrown internally when the user sends /cancel while a conversation is waiting for input. */
export class ConversationCancelled extends Error {}

/**
 * Drop-in replacement for `conversation.waitFor` that lets the user abort the current
 * scenario at any prompt by sending /cancel. Callers don't need to check for cancellation
 * themselves — wrap the whole conversation body with `runCancellable` instead.
 */
export async function waitFor<Q extends FilterQuery>(
  conversation: Conversation<MyContext, MyContext>,
  ctx: MyContext,
  query: Q | Q[],
  opts?: OtherwiseOptions<MyContext>
): Promise<Filter<MyContext, Q>> {
  const result = await conversation.waitFor(query, opts);
  const text = (result.message as { text?: string } | undefined)?.text?.trim();
  if (text === CANCEL_COMMAND) {
    await ctx.reply("Сценарий отменён.");
    throw new ConversationCancelled();
  }
  return result;
}

/** Wraps a conversation body so a /cancel-triggered abort exits cleanly instead of hitting bot.catch. */
export async function runCancellable(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConversationCancelled) return;
    throw err;
  }
}
