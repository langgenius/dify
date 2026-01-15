export const getToolTokenRegexString = (): string => {
  return '§tool\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+\\.[a-fA-F0-9-]{36}§'
}

export const parseToolToken = (text: string) => {
  const match = /^§tool\.([\w-]+)\.([\w-]+)\.([a-fA-F0-9-]{36})§$/.exec(text)
  if (!match)
    return null
  return {
    provider: match[1],
    tool: match[2],
    configId: match[3],
  }
}

export const buildToolToken = (payload: { provider: string, tool: string, configId: string }) => {
  return `§tool.${payload.provider}.${payload.tool}.${payload.configId}§`
}
