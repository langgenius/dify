const TOOL_TOKEN_REGEX = /§\[tool\]\.\[[\w-]+(?:\/[\w-]+)*\]\.\[[\w-]+\]\.\[([a-fA-F0-9-]{36})\]§/g

export const extractToolConfigIds = (content: string) => {
  const ids = new Set<string>()
  if (!content)
    return ids
  TOOL_TOKEN_REGEX.lastIndex = 0
  let match = TOOL_TOKEN_REGEX.exec(content)
  while (match) {
    if (match[1])
      ids.add(match[1])
    match = TOOL_TOKEN_REGEX.exec(content)
  }
  return ids
}
