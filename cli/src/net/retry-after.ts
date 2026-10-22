const DELTA_SECONDS = /^\d+$/
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/
const MS_PER_SECOND = 1000

export function retryAfterSeconds(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined
  if (DELTA_SECONDS.test(header)) {
    const seconds = Number(header)
    return Number.isSafeInteger(seconds) ? seconds : undefined
  }
  if (!HTTP_DATE.test(header)) return undefined
  const dateMs = Date.parse(header)
  if (Number.isNaN(dateMs)) return undefined
  return Math.max(0, Math.ceil((dateMs - nowMs) / MS_PER_SECOND))
}
