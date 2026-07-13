function getRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

export function getInviteErrorCode(error: unknown) {
  const errorRecord = getRecord(error)
  const dataRecord = getRecord(errorRecord?.data)
  const bodyRecord = getRecord(dataRecord?.body)
  const code = bodyRecord?.code ?? errorRecord?.code

  return typeof code === 'string' ? code : null
}
