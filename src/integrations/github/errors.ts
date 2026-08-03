export function isGithubNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: unknown }).status === 404;
}

/** GitHub returns 404 (not 403) for both "repo doesn't exist" and "token has no access" to avoid leaking
 * private-repo existence, so a 404 here almost always means the saved PAT (see /setgithub) can't see this repo. */
export const GITHUB_404_HINT =
  "репозиторий не найден этим токеном — либо неверный owner/repo, либо у GitHub PAT нет доступа: " +
  "проверьте, что у классического токена есть scope 'repo' (или у fine-grained — разрешение Contents: Read) " +
  "и что репозиторий включён в его доступ; если организация использует SSO, токен нужно отдельно " +
  "авторизовать через 'Enable SSO' на странице токена в GitHub";
