type DifyBuilderErrorCopy = {
  fallback: string
  codeMessages: Readonly<Record<string, string>>
}

type ParsedDifyBuilderError = {
  code?: string
  message?: string
  status?: number
  statusText?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readNonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const readDetailMessage = (detail: unknown) => {
  const directMessage = readNonEmptyString(detail)
  if (directMessage) return directMessage
  if (!Array.isArray(detail)) return

  const messages = detail.flatMap((item) => {
    const itemMessage = readNonEmptyString(item)
    if (itemMessage) return [itemMessage]
    if (!isRecord(item)) return []

    return [readNonEmptyString(item.msg), readNonEmptyString(item.message)].filter(
      (message): message is string => message !== undefined,
    )
  })
  return messages.length > 0 ? messages.join('; ') : undefined
}

const parsePayload = (payload: unknown): Pick<ParsedDifyBuilderError, 'code' | 'message'> => {
  const directMessage = readNonEmptyString(payload)
  if (directMessage) return { message: directMessage }
  if (payload instanceof Error) return { message: readNonEmptyString(payload.message) }
  if (!isRecord(payload)) return {}

  const records = [payload]
  if (isRecord(payload.data)) records.push(payload.data)
  if (isRecord(payload.body)) records.push(payload.body)

  for (const record of records) {
    const message =
      readNonEmptyString(record.message) ??
      readNonEmptyString(record.error) ??
      readDetailMessage(record.detail)
    if (message) return { message }
  }

  for (const record of records) {
    const code = readNonEmptyString(record.code)
    if (code) return { code }
  }

  return {}
}

const parseResponse = async (response: Response): Promise<ParsedDifyBuilderError> => {
  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    try {
      payload = await response.clone().text()
    } catch {}
  }

  return {
    ...parsePayload(payload),
    status: response.status,
    statusText: readNonEmptyString(response.statusText),
  }
}

export const getDifyBuilderErrorMessage = async (error: unknown, copy: DifyBuilderErrorCopy) => {
  const parsed: ParsedDifyBuilderError =
    error instanceof Response ? await parseResponse(error) : parsePayload(error)
  if (parsed.message) return parsed.message
  if (parsed.code) return copy.codeMessages[parsed.code] ?? `${copy.fallback} (${parsed.code})`
  if (parsed.status) {
    const status = `HTTP ${parsed.status}${parsed.statusText ? ` ${parsed.statusText}` : ''}`
    return `${copy.fallback} (${status})`
  }
  return copy.fallback
}
