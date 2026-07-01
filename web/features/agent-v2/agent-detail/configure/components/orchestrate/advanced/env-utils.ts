const stripInlineComment = (value: string) => {
  for (let index = 0; index < value.length; index++) {
    const previousChar = value[index - 1] ?? ''

    if (value[index] === '#' && (index === 0 || /\s/.test(previousChar)))
      return value.slice(0, index).trimEnd()
  }

  return value
}

const parseEnvValue = (rawValue: string) => {
  const value = rawValue.trim()
  const quote = value[0]

  if ((quote === '"' || quote === '\'') && value.endsWith(quote)) {
    const unquotedValue = value.slice(1, -1)

    if (quote === '"') {
      return unquotedValue
        .replaceAll('\\n', '\n')
        .replaceAll('\\r', '\r')
        .replaceAll('\\t', '\t')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\')
    }

    return unquotedValue.replaceAll('\\\'', '\'')
  }

  return stripInlineComment(value).trim()
}

export const parseEnvImport = (content: string) => {
  const variables: Array<{ key: string, value: string }> = []
  let invalidLineCount = 0

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#'))
      continue

    const envLine = trimmedLine.startsWith('export ')
      ? trimmedLine.slice('export '.length).trimStart()
      : trimmedLine
    const separatorIndex = envLine.indexOf('=')

    if (separatorIndex <= 0) {
      invalidLineCount += 1
      continue
    }

    const key = envLine.slice(0, separatorIndex).trim()

    if (!/^[\w.-]+$/.test(key)) {
      invalidLineCount += 1
      continue
    }

    variables.push({
      key,
      value: parseEnvValue(envLine.slice(separatorIndex + 1)),
    })
  }

  return {
    invalidLineCount,
    variables,
  }
}

export const parseEnvVariables = (content: string) => parseEnvImport(content).variables

export type EnvImportPlatform = 'mac' | 'windows' | 'other'

export const getEnvImportPlatform = ({
  platform,
  userAgent,
}: {
  platform?: string
  userAgent?: string
}): EnvImportPlatform => {
  const normalizedPlatform = platform?.toLowerCase() ?? ''
  const normalizedUserAgent = userAgent?.toLowerCase() ?? ''

  if (normalizedPlatform.includes('mac') || normalizedUserAgent.includes('mac os'))
    return 'mac'

  if (normalizedPlatform.includes('win') || normalizedUserAgent.includes('windows'))
    return 'windows'

  return 'other'
}
