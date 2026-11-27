/**
 * The agents this product knows by name. One entry carries everything agent-specific the UI
 * shows: adding another agent is adding an entry here.
 */
import type { TFunction } from 'i18next'

/** The name agents register the server under; also used in the personal-token snippets. */
const AGENT_MCP_SERVER_NAME = 'knowledge'
export const AGENT_TOKEN_ENV = 'KNOWLEDGE_MCP_TOKEN'

export type AgentDefinition = {
  id: string
  /** Display name. */
  name: string
  /** Icon and color classes of the agent's mark. */
  icon: string
  /** Recognises the agent in the name a client gives itself. */
  clientName: RegExp
  /** Commands that add the server; the agent then signs in through the browser (OAuth). */
  connectCommands: (mcpUrl: string) => string[]
  /** What is left to do in the agent once the commands ran, when it does not say so itself. */
  connectHint?: (t: TFunction<['knowledgeSpace']>) => string
  /** For agents that cannot sign in through a browser: the token comes from an environment variable. */
  tokenConfig: { file: string; build: (mcpUrl: string) => string }
}

export const AGENTS: readonly AgentDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'i-ri-claude-fill text-[#D97757]',
    clientName: /claude|anthropic/i,
    connectCommands: (mcpUrl) => [
      `claude mcp add --transport http ${AGENT_MCP_SERVER_NAME} ${mcpUrl}`,
    ],
    connectHint: (t) => t(($) => $['agents.claudeCodeHint'], { name: AGENT_MCP_SERVER_NAME }),
    tokenConfig: {
      file: '.mcp.json',
      build: (mcpUrl) =>
        JSON.stringify(
          {
            mcpServers: {
              [AGENT_MCP_SERVER_NAME]: {
                type: 'http',
                url: mcpUrl,
                headers: { Authorization: `Bearer \${${AGENT_TOKEN_ENV}}` },
              },
            },
          },
          null,
          2,
        ),
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: 'i-ri-openai-fill text-text-primary',
    clientName: /codex|openai|chatgpt/i,
    connectCommands: (mcpUrl) => [
      `codex mcp add ${AGENT_MCP_SERVER_NAME} --url ${mcpUrl}`,
      `codex mcp login ${AGENT_MCP_SERVER_NAME}`,
    ],
    tokenConfig: {
      file: '~/.codex/config.toml',
      build: (mcpUrl) =>
        `[mcp_servers.${AGENT_MCP_SERVER_NAME}]\nurl = "${mcpUrl}"\nbearer_token_env_var = "${AGENT_TOKEN_ENV}"`,
    },
  },
]

/**
 * The known agent a client name points at. Clients name themselves, so this is a hint for the
 * eye, never an identity check.
 */
export function recogniseAgent(clientName: string | null | undefined) {
  return clientName ? AGENTS.find((agent) => agent.clientName.test(clientName)) : undefined
}
