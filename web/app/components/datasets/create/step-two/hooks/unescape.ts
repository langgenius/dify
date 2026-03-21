// https://github.com/iamakulov/unescape-js/blob/master/src/index.js

/**
 * \\ - matches the backslash which indicates the beginning of an escape sequence
 * (
 *   u\{([0-9A-Fa-f]+)\} - first alternative; matches the variable-length hexadecimal escape sequence (\u{ABCD0})
 * |
 *   u([0-9A-Fa-f]{4}) - second alternative; matches the 4-digit hexadecimal escape sequence (\uABCD)
 * |
 *   x([0-9A-Fa-f]{2}) - third alternative; matches the 2-digit hexadecimal escape sequence (\xA5)
 * |
 *   ([1-7][0-7]{0,2}|[0-7]{2,3}) - fourth alternative; matches the up-to-3-digit octal escape sequence (\5 or \512)
 * |
 *   (['"tbrnfv0\\]) - fifth alternative; matches the special escape characters (\t, \n and so on)
 * |
 *   \U([0-9A-Fa-f]+) - sixth alternative; matches the 8-digit hexadecimal escape sequence used by python (\U0001F3B5)
 * )
 */
const jsEscapeRegex = /\\(u\{([0-9A-Fa-f]+)\}|u([0-9A-Fa-f]{4})|x([0-9A-Fa-f]{2})|([1-7][0-7]{0,2}|[0-7]{2,3})|(['"tbrnfv0\\]))|\\U([0-9A-Fa-f]{8})/g

const usualEscapeSequences: Record<string, string> = {
  '0': '\0',
  'b': '\b',
  'f': '\f',
  'n': '\n',
  'r': '\r',
  't': '\t',
  'v': '\v',
  '\'': '\'',
  '"': '"',
  '\\': '\\',
}

const fromHex = (str: string) => String.fromCodePoint(Number.parseInt(str, 16))
const fromOct = (str: string) => String.fromCodePoint(Number.parseInt(str, 8))

const unescape = (str: string) => {
  return str.replace(jsEscapeRegex, (_, __, varHex, longHex, shortHex, octal, specialCharacter, python) => {
    if (varHex !== undefined)
      return fromHex(varHex)
    else if (longHex !== undefined)
      return fromHex(longHex)
    else if (shortHex !== undefined)
      return fromHex(shortHex)
    else if (octal !== undefined)
      return fromOct(octal)
    else if (python !== undefined)
      return fromHex(python)
    else
      return usualEscapeSequences[specialCharacter]
  })
}

export default unescape
