const SHELL_SAFE = /^[\w@%+=:,./~-]+$/
const QUOTE = "'"
const ESCAPED_QUOTE = `'\\''`

export function shellWord(text: string): string {
  if (SHELL_SAFE.test(text)) return text
  return `${QUOTE}${text.split(QUOTE).join(ESCAPED_QUOTE)}${QUOTE}`
}
