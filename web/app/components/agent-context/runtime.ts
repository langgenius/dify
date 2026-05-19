'use client'

import type {
  AgentContextApi,
  AgentPageContextProvider,
  AgentTool,
  AgentToolDefinition,
  AgentToolInput,
  AgentToolResult,
} from './types'

const RUNTIME_VERSION = '2026-05-19'

const tools = new Map<string, AgentTool>()
const pageContextProviders = new Map<string, AgentPageContextProvider>()
const webMcpControllers = new Map<string, AbortController>()
let runtimeApi: AgentContextApi | undefined

const getToolDefinition = (tool: AgentTool): AgentToolDefinition => {
  const {
    execute: _execute,
    ...definition
  } = tool
  return definition
}

const getToolDefinitions = () => {
  return [...tools.values()].map(getToolDefinition)
}

const normalizeTestingInput = (input?: string | AgentToolInput) => {
  if (typeof input !== 'string')
    return input

  if (!input)
    return {}

  const value = JSON.parse(input) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {}

  return value as AgentToolInput
}

const callTool = async (name: string, input?: AgentToolInput): Promise<AgentToolResult> => {
  const tool = tools.get(name)
  if (!tool)
    throw new Error(`Dify agent tool "${name}" is not registered.`)

  return tool.execute(input)
}

const collectPageContexts = () => {
  return [...pageContextProviders.entries()].map(([id, provider]) => {
    try {
      return {
        id,
        value: provider(),
      }
    }
    catch (error) {
      return {
        id,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
}

export const getRegisteredPageContexts = () => collectPageContexts()

export const registerDifyAgentPageContext = (id: string, provider: AgentPageContextProvider) => {
  pageContextProviders.set(id, provider)

  return () => {
    if (pageContextProviders.get(id) === provider)
      pageContextProviders.delete(id)
  }
}

const ensureWebMcpTestingApi = (api: AgentContextApi) => {
  try {
    Object.defineProperty(navigator, 'modelContextTesting', {
      configurable: true,
      value: {
        executeTool: (name: string, input?: string | AgentToolInput) => api.callTool(name, normalizeTestingInput(input)),
        listTools: () => api.listTools(),
      },
    })
  }
  catch (error) {
    console.warn('[Dify Agent Context] WebMCP testing API registration failed:', error)
  }
}

const ensureWindowApi = () => {
  if (typeof window === 'undefined')
    return undefined

  runtimeApi ??= {
    version: RUNTIME_VERSION,
    callTool,
    getPageContext: () => callTool('dify_get_page_context', {}),
    listTools: getToolDefinitions,
    registerPageContext: registerDifyAgentPageContext,
  }

  window.__DIFY_AGENT_CONTEXT__ = runtimeApi
  ensureWebMcpTestingApi(runtimeApi)
  return runtimeApi
}

const registerWithWebMCP = (tool: AgentTool) => {
  if (typeof window === 'undefined')
    return false

  const modelContext = navigator.modelContext
  if (!modelContext?.registerTool)
    return false

  if (webMcpControllers.has(tool.name))
    return true

  const controller = new AbortController()

  try {
    modelContext.registerTool(tool, { signal: controller.signal })
    webMcpControllers.set(tool.name, controller)
    return true
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('already registered'))
      console.warn('[Dify Agent Context] WebMCP tool registration failed:', tool.name, error)
    return false
  }
}

export const registerDifyAgentTools = (nextTools: AgentTool[]) => {
  const api = ensureWindowApi()
  if (!api)
    return () => undefined

  nextTools.forEach((tool) => {
    tools.set(tool.name, tool)
    registerWithWebMCP(tool)
  })

  return () => {
    nextTools.forEach((tool) => {
      if (tools.get(tool.name) === tool)
        tools.delete(tool.name)

      const controller = webMcpControllers.get(tool.name)
      if (controller) {
        controller.abort()
        webMcpControllers.delete(tool.name)
      }
    })
  }
}
