export const getFileReferenceTokenRegexString = (): string => {
  return '§\\[file\\]\\.\\[app\\]\\.\\[[a-fA-F0-9-]{36}\\]§'
}

export const parseFileReferenceToken = (text: string) => {
  const match = /^§\[file\]\.\[app\]\.\[([a-fA-F0-9-]{36})\]§$/.exec(text)
  if (!match)
    return null
  return {
    resourceId: match[1],
  }
}

export const buildFileReferenceToken = (resourceId: string) => {
  return `§[file].[app].[${resourceId}]§`
}
