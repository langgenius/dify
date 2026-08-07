/**
 * @fileoverview Utility functions for preprocessing Markdown content.
 * These functions were extracted from the main markdown renderer for better separation of concerns.
 * Includes preprocessing for LaTeX and custom "think" tags.
 */
import { flow } from 'es-toolkit/compat'
import { ALLOW_UNSAFE_DATA_SCHEME } from '@/config'

const FENCED_CODE_BLOCK_REGEX = /(```[\s\S]*?(?:```|$))/g
const LATEX_DELIMITER_MARKER_REGEX = /\\[[(]/
const THINK_TAG_MARKER_REGEX = /<think>|<\/think>|<\/details>/
const THINK_OPEN_TAG_REGEX = /(<think>\s*)+/g
const THINK_CLOSE_TAG_REGEX = /(\s*<\/think>)+/g
const DETAILS_FOLLOWED_BY_CONTENT_ON_SAME_LINE_REGEX = /(<\/details>)[^\S\r\n]*(?=\S)/g
const DETAILS_FOLLOWED_BY_CONTENT_ON_NEXT_LINE_REGEX =
  /(<\/details>)[^\S\r\n]*\r?\n(?=[^\S\r\n]*\S)/g

const preprocessTextLaTeX = flow([
  (str: string) => str.replace(/\\\[(.*?)\\\]/g, (_, equation) => `$$${equation}$$`),
  (str: string) => str.replace(/\\\[([\s\S]*?)\\\]/g, (_, equation) => `$$${equation}$$`),
  (str: string) => str.replace(/\\\((.*?)\\\)/g, (_, equation) => `$$${equation}$$`),
  (str: string) =>
    str.replace(/(^|[^\\])\$(.+?)\$/g, (_, prefix, equation) => `${prefix}$${equation}$`),
])

const replaceThinkTags = flow([
  (str: string) => str.replace(THINK_OPEN_TAG_REGEX, '<details data-think=true>\n'),
  (str: string) => str.replace(THINK_CLOSE_TAG_REGEX, '\n[ENDTHINKFLAG]</details>'),
  (str: string) => str.replace(DETAILS_FOLLOWED_BY_CONTENT_ON_NEXT_LINE_REGEX, '$1\n\n'),
  (str: string) => str.replace(DETAILS_FOLLOWED_BY_CONTENT_ON_SAME_LINE_REGEX, '$1\n\n'),
])

export const preprocessLaTeX = (content: string) => {
  if (typeof content !== 'string') return content
  if (!LATEX_DELIMITER_MARKER_REGEX.test(content)) return content

  return content
    .split(FENCED_CODE_BLOCK_REGEX)
    .map((segment) => (segment.startsWith('```') ? segment : preprocessTextLaTeX(segment)))
    .join('')
}

export const preprocessThinkTag = (content: string) => {
  if (!THINK_TAG_MARKER_REGEX.test(content)) return content
  return replaceThinkTags(content)
}

/**
 * Transforms a URI for use in react-markdown, ensuring security and compatibility.
 * This function is designed to work with react-markdown v9+ which has stricter
 * default URL handling.
 *
 * Behavior:
 * 1. Always allows the custom 'abbr:' protocol.
 * 2. Always allows page-local fragments (e.g., "#some-id").
 * 3. Always allows protocol-relative URLs (e.g., "//example.com/path").
 * 4. Always allows purely relative paths (e.g., "path/to/file", "/abs/path").
 * 5. Allows absolute URLs if their scheme is in a permitted list (case-insensitive):
 *    'http:', 'https:', 'mailto:', 'xmpp:', 'irc:', 'ircs:'.
 * 6. Intelligently distinguishes colons used for schemes from colons within
 *    paths, query parameters, or fragments of relative-like URLs.
 * 7. Returns the original URI if allowed, otherwise returns `undefined` to
 *    signal that the URI should be removed/disallowed by react-markdown.
 */
export const customUrlTransform = (uri: string): string | undefined => {
  const PERMITTED_SCHEME_REGEX = /^(https?|ircs?|mailto|xmpp|abbr):$/i

  if (uri.startsWith('#')) return uri

  if (uri.startsWith('//')) return uri

  const colonIndex = uri.indexOf(':')

  if (colonIndex === -1) return uri

  const slashIndex = uri.indexOf('/')
  const questionMarkIndex = uri.indexOf('?')
  const hashIndex = uri.indexOf('#')

  if (
    (slashIndex !== -1 && colonIndex > slashIndex) ||
    (questionMarkIndex !== -1 && colonIndex > questionMarkIndex) ||
    (hashIndex !== -1 && colonIndex > hashIndex)
  ) {
    return uri
  }

  const scheme = uri.substring(0, colonIndex + 1).toLowerCase()
  if (PERMITTED_SCHEME_REGEX.test(scheme)) return uri

  if (ALLOW_UNSAFE_DATA_SCHEME && scheme === 'data:') return uri

  return undefined
}
