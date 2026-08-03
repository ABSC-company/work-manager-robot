import { Version3Client } from "jira.js";

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export function createJiraClient(creds: JiraCredentials): Version3Client {
  return new Version3Client({
    host: creds.baseUrl,
    authentication: {
      basic: {
        email: creds.email,
        apiToken: creds.apiToken,
      },
    },
  });
}
