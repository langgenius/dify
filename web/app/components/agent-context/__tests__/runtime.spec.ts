import type { AgentTool } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegisteredPageContexts, registerDifyAgentPageContext, registerDifyAgentTools } from '../runtime'

describe('agent context runtime', () => {
  const registerTool = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.__DIFY_AGENT_CONTEXT__ = undefined
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool,
      },
    })
    Object.defineProperty(navigator, 'modelContextTesting', {
      configurable: true,
      value: undefined,
    })
  })

  afterEach(() => {
    window.__DIFY_AGENT_CONTEXT__ = undefined
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(navigator, 'modelContextTesting', {
      configurable: true,
      value: undefined,
    })
  })

  it('should expose tools through window fallback and WebMCP registration', async () => {
    const tool: AgentTool = {
      name: 'dify_test_tool',
      description: 'Test tool',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: () => ({ ok: true }),
    }

    const cleanup = registerDifyAgentTools([tool])

    expect(window.__DIFY_AGENT_CONTEXT__).toBeDefined()
    expect(window.__DIFY_AGENT_CONTEXT__!.listTools()).toEqual([
      {
        name: 'dify_test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ])
    expect(registerTool).toHaveBeenCalledWith(tool, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await expect(window.__DIFY_AGENT_CONTEXT__!.callTool('dify_test_tool')).resolves.toEqual({ ok: true })
    expect(await navigator.modelContextTesting!.listTools()).toEqual([
      {
        name: 'dify_test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ])
    await expect(navigator.modelContextTesting!.executeTool('dify_test_tool', '{}')).resolves.toEqual({ ok: true })

    cleanup()
  })

  it('should upgrade the early public fallback after React hydration', async () => {
    const staleTestingApi = {
      executeTool: vi.fn(async () => ({ stale: true })),
      listTools: vi.fn(() => []),
    }
    window.__DIFY_AGENT_CONTEXT__ = {
      version: 'public-fallback',
      callTool: vi.fn(async () => ({ stale: true })),
      getPageContext: vi.fn(async () => ({ stale: true })),
      listTools: vi.fn(() => []),
      registerPageContext: vi.fn(() => vi.fn()),
    }
    Object.defineProperty(navigator, 'modelContextTesting', {
      configurable: true,
      value: staleTestingApi,
    })

    const tool: AgentTool = {
      name: 'dify_hydrated_tool',
      description: 'Hydrated tool',
      execute: () => ({ hydrated: true }),
    }

    const cleanup = registerDifyAgentTools([tool])

    expect(window.__DIFY_AGENT_CONTEXT__!.version).toBe('2026-05-19')
    expect(window.__DIFY_AGENT_CONTEXT__!.listTools()).toEqual([
      {
        name: 'dify_hydrated_tool',
        description: 'Hydrated tool',
      },
    ])
    await expect(navigator.modelContextTesting!.executeTool('dify_hydrated_tool', '{}')).resolves.toEqual({ hydrated: true })
    expect(staleTestingApi.executeTool).not.toHaveBeenCalled()

    cleanup()
  })

  it('should register and remove page context providers', () => {
    const cleanup = registerDifyAgentPageContext('test-page', () => ({ page: 'test' }))

    expect(getRegisteredPageContexts()).toEqual([
      {
        id: 'test-page',
        value: { page: 'test' },
      },
    ])

    cleanup()

    expect(getRegisteredPageContexts()).toEqual([])
  })
})
