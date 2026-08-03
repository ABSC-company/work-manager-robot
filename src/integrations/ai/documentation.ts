import fs from "node:fs/promises";
import mammoth from "mammoth";
import type { Documentation } from "@prisma/client";
import { createGithubClient } from "../github/client";
import { isGithubNotFound, GITHUB_404_HINT } from "../github/errors";
import { logger } from "../../utils/logger";

const MAX_DOC_CHARS = 8000;

/** Extracts plain text from a direction's documentation sources, truncated to keep AI prompts cheap. */
export async function extractDocumentationText(
  docs: Documentation[],
  githubToken: string | null
): Promise<string> {
  const parts: string[] = [];

  for (const doc of docs) {
    try {
      if (doc.type === "FILE" && doc.filePath) {
        const text = await readFileAsText(doc.filePath);
        parts.push(`### ${doc.name}\n${text}`);
      } else if (doc.type === "GITHUB_REPO" && doc.url && githubToken) {
        const text = await readGithubReadme(doc.url, githubToken);
        if (text) parts.push(`### ${doc.name} (README)\n${text}`);
      }
    } catch (err) {
      logger.warn({ err, doc: doc.name, hint: isGithubNotFound(err) ? GITHUB_404_HINT : undefined }, "failed to extract documentation text");
    }
  }

  const combined = parts.join("\n\n");
  return combined.length > MAX_DOC_CHARS ? combined.slice(0, MAX_DOC_CHARS) + "\n...[truncated]" : combined;
}

async function readFileAsText(filePath: string): Promise<string> {
  if (filePath.toLowerCase().endsWith(".docx")) {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return fs.readFile(filePath, "utf8");
}

async function readGithubReadme(repoUrl: string, token: string): Promise<string | null> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  const repoSlug = match ? `${match[1]}/${match[2]}` : repoUrl;
  const [owner, repo] = repoSlug.replace(/\.git$/, "").split("/");
  if (!owner || !repo) return null;

  const octokit = createGithubClient(token);
  const res = await octokit.rest.repos.getReadme({ owner, repo });
  const content = Buffer.from(res.data.content, "base64").toString("utf8");
  return content;
}
