export type ToolToken = {
  provider: string
  tool: string
  configId: string
}

export const getToolTokenRegexString = (): string => {
  return '§\\[tool\\]\\.\\[[a-zA-Z0-9_-]+(?:\\/[a-zA-Z0-9_-]+)*\\]\\.\\[[a-zA-Z0-9_-]+\\]\\.\\[[a-fA-F0-9-]{36}\\]§'
}

export const getToolTokenListRegexString = (): string => {
  const token = getToolTokenRegexString()
  return `\\[(?:${token})(?:\\s*,\\s*${token})*\\]`
}

export const parseToolToken = (text: string): ToolToken | null => {
  const match = /^§\[tool\]\.\[([\w-]+(?:\/[\w-]+)*)\]\.\[([\w-]+)\]\.\[([a-fA-F0-9-]{36})\]§$/.exec(text)
  if (!match)
    return null
  return {
    provider: match[1],
    tool: match[2],
    configId: match[3],
  }
}

export const parseToolTokenList = (text: string): ToolToken[] | null => {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']'))
    return null
  const content = trimmed.slice(1, -1).trim()
  if (!content)
    return null
  const tokens = content.split(',').map(token => token.trim()).filter(Boolean)
  if (!tokens.length)
    return null
  const parsed = tokens.map(token => parseToolToken(token))
  if (parsed.some(item => !item))
    return null
  return parsed as ToolToken[]
}

export const buildToolToken = (payload: ToolToken) => {
  return `§[tool].[${payload.provider}].[${payload.tool}].[${payload.configId}]§`
}

export const buildToolTokenList = (tokens: ToolToken[]) => {
  return `[${tokens.map(buildToolToken).join(',')}]`
}
