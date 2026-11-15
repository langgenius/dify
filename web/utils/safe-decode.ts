/**
 * Decodes a URL query parameter without throwing on malformed input.
 *
 * `decodeURIComponent` throws a URIError when the value contains an
 * incomplete or invalid percent-encoding sequence (for example, a link
 * truncated by a mail client). Auth pages read query parameters during
 * render, so one malformed parameter would break the whole page.
 *
 * Falls back to the raw value when the input cannot be decoded, and
 * returns an empty string for missing parameters.
 */
export function safeDecodeURIComponent(value: string | null | undefined): string {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
