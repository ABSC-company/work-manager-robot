import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config";

export const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export const AI_MODEL = config.anthropic.model;
