import { ORPCError } from '@orpc/client'

/** The name agents register the server under; also used in the personal-token snippets. */
export const AGENT_MCP_SERVER_NAME = 'dify-knowledge'
export const AGENT_TOKEN_ENV = 'DIFY_KNOWLEDGE_TOKEN'
export const PERSONAL_TOKEN_EXPIRY_DAYS = [7, 30, 90] as const
export const DEFAULT_PERSONAL_TOKEN_EXPIRY_DAYS = 30

/** Commands that add the server; the agent then signs in through the browser (OAuth). */
export function agentConnectCommands(mcpUrl: string) {
  return {
    claudeCode: `claude mcp add --transport http ${AGENT_MCP_SERVER_NAME} ${mcpUrl}`,
    codex: [
      `codex mcp add ${AGENT_MCP_SERVER_NAME} --url ${mcpUrl}`,
      `codex mcp login ${AGENT_MCP_SERVER_NAME}`,
    ],
  }
}

/** For agents that cannot sign in through a browser: the token comes from an environment variable. */
export function personalTokenSnippets(mcpUrl: string) {
  return {
    claudeCode: `claude mcp add --transport http ${AGENT_MCP_SERVER_NAME} ${mcpUrl} --header "Authorization: Bearer $${AGENT_TOKEN_ENV}"`,
    codex: `[mcp_servers.${AGENT_MCP_SERVER_NAME}]\nurl = "${mcpUrl}"\nbearer_token_env_var = "${AGENT_TOKEN_ENV}"`,
  }
}

export function agentAccessErrorCode(error: unknown): string | undefined {
  return error instanceof ORPCError && typeof error.code === 'string' ? error.code : undefined
}

/** Knowledge bases the server refused for a connection (`details.knowledge_base_ids`). */
export function rejectedKnowledgeBaseIds(error: unknown): string[] {
  if (!(error instanceof ORPCError)) return []
  const data: unknown = error.data
  const details =
    typeof data === 'object' && data !== null && 'details' in data ? data.details : undefined
  const ids =
    typeof details === 'object' && details !== null && 'knowledge_base_ids' in details
      ? details.knowledge_base_ids
      : undefined
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}
