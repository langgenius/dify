import { AGENTS, recogniseAgent } from '../agents'

const MCP_URL = 'https://api.dify.test/mcp/knowledge'

describe('agent registry', () => {
  it('has distinct agents', () => {
    expect(AGENTS.length).toBeGreaterThan(0)
    expect(new Set(AGENTS.map((agent) => agent.id)).size).toBe(AGENTS.length)
  })

  it.each(AGENTS.map((agent) => [agent.name, agent] as const))(
    '%s can be connected, configured with a token and recognised',
    (_name, agent) => {
      const commands = agent.connectCommands(MCP_URL)
      expect(commands.some((command) => command.includes(MCP_URL))).toBe(true)
      expect(agent.tokenConfig.build(MCP_URL)).toContain(MCP_URL)
      expect(agent.tokenConfig.build(MCP_URL)).toContain('KNOWLEDGE_MCP_TOKEN')
      expect(agent.tokenConfig.file).not.toBe('')
      expect(agent.icon).toMatch(/^i-/)
      // Its own name must never be taken for another agent's.
      expect(recogniseAgent(agent.name)).toBe(agent)
    },
  )

  it('does not guess at a client it does not know', () => {
    expect(recogniseAgent('Some MCP client')).toBeUndefined()
    expect(recogniseAgent(null)).toBeUndefined()
  })
})
