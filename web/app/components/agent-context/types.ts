'use client'

export type AgentJsonSchema = {
  type: string
  description?: string
  properties?: Record<string, AgentJsonSchema>
  items?: AgentJsonSchema
  required?: string[]
  enum?: string[]
  additionalProperties?: boolean | AgentJsonSchema
}

export type AgentToolInput = Record<string, unknown>

export type AgentToolResult = Record<string, unknown> | string | number | boolean | null | AgentToolResult[] | {
  [key: string]: AgentToolResult
}

export type AgentTool = {
  name: string
  title?: string
  description: string
  inputSchema?: AgentJsonSchema
  annotations?: {
    readOnlyHint?: boolean
    untrustedContentHint?: boolean
  }
  execute: (input?: AgentToolInput) => AgentToolResult | Promise<AgentToolResult>
}

export type AgentToolDefinition = Omit<AgentTool, 'execute'>

export type AgentPageContextProvider = () => AgentToolResult

export type AgentContextApi = {
  version: string
  callTool: (name: string, input?: AgentToolInput) => Promise<AgentToolResult>
  getPageContext: () => Promise<AgentToolResult>
  listTools: () => AgentToolDefinition[]
  registerPageContext: (id: string, provider: AgentPageContextProvider) => () => void
}

export type WebMCPModelContext = {
  registerTool: (tool: AgentTool, options?: { signal?: AbortSignal }) => void
}

export type WebMCPTestingContext = {
  executeTool: (name: string, input?: string | AgentToolInput) => Promise<AgentToolResult>
  listTools: () => AgentToolDefinition[] | Promise<AgentToolDefinition[]>
}

declare global {
  // eslint-disable-next-line ts/consistent-type-definitions -- interface required for declaration merging
  interface Navigator {
    modelContext?: WebMCPModelContext
    modelContextTesting?: WebMCPTestingContext
  }

  // eslint-disable-next-line ts/consistent-type-definitions -- interface required for declaration merging
  interface Window {
    __DIFY_AGENT_CONTEXT__?: AgentContextApi
  }
}
