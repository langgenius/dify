export const TERMINAL_WIDTH_FALLBACK = 80
const ELLIPSIS = '…'

export function terminalWidth(): number {
  const cols = process.stdout.columns
  return typeof cols === 'number' && cols > 0 ? cols : TERMINAL_WIDTH_FALLBACK
}

export function truncate(s: string, max: number): string {
  if (s === '' || max <= 0)
    return ''
  if (s.length <= max)
    return s
  if (max === 1)
    return ELLIPSIS
  return s.slice(0, max - 1) + ELLIPSIS
}
