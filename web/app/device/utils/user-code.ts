// user-code.ts — input normalisation + validation for the RFC 8628
// 8-character user_code format the CLI prints to stderr.
//
// Format: XXXX-XXXX, uppercase, reduced alphabet (no 0/O, 1/I/l, 2/Z). Low
// entropy by design — humans type it — so the server-side rate-limit + TTL +
// single-use properties are what defend it, not the alphabet.

export const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXY3456789' // excludes 0 O 1 I L 2 Z

/**
 * normaliseUserCodeInput prepares raw input for display in the code field:
 * strips non-alphanumerics, uppercases, drops disallowed characters, and
 * inserts the hyphen after the fourth accepted char.
 *
 * Returns at most 9 chars ("XXXX-XXXX"); longer input is truncated.
 */
export function normaliseUserCodeInput(raw: string): string {
  const cleaned: string[] = []
  for (const ch of raw.toUpperCase()) {
    if (USER_CODE_ALPHABET.includes(ch))
      cleaned.push(ch)
    if (cleaned.length === 8)
      break
  }
  if (cleaned.length <= 4)
    return cleaned.join('')
  return `${cleaned.slice(0, 4).join('')}-${cleaned.slice(4).join('')}`
}

/**
 * isValidUserCode tests whether the normalised form is a complete XXXX-XXXX
 * token suitable for submission to /openapi/v1/oauth/device/lookup.
 */
export function isValidUserCode(normalised: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalised)
    && [...normalised.replace('-', '')].every(c => USER_CODE_ALPHABET.includes(c))
}
