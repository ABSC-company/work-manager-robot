import { Bot, Context, SessionFlavor, session } from "grammy";
import { conversations, ConversationFlavor } from "@grammyjs/conversations";
import { config } from "../config";

export interface SessionData {
  activeCompanyId?: string;
}

export type MyContext = Context & SessionFlavor<SessionData>;
export type BotContext = ConversationFlavor<MyContext>;

export const bot = new Bot<BotContext>(config.telegram.botToken);

bot.use(session({ initial: (): SessionData => ({}) }));
bot.use(conversations());
