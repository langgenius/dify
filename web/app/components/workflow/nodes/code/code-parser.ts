import type { OutputVar } from './types'
import { VarType } from '../../types'
import { CodeLanguage } from './types'

const splitTopLevelParams = (rawParams: string, language: CodeLanguage) => {
  const params: string[] = []
  let start = 0
  let nesting = 0
  let quote: string | undefined
  let escaped = false

  for (let i = 0; i < rawParams.length; i++) {
    const char = rawParams[i]!

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (rawParams.startsWith(quote, i)) {
        i += quote.length - 1
        quote = undefined
      }
      continue
    }

    if (char === '"' || char === "'" || (language === CodeLanguage.javascript && char === '`')) {
      quote =
        language === CodeLanguage.python3 && rawParams.startsWith(char.repeat(3), i)
          ? char.repeat(3)
          : char
      i += quote.length - 1
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      nesting++
    } else if (char === ')' || char === ']' || char === '}') {
      nesting = Math.max(0, nesting - 1)
    } else if (char === ',' && nesting === 0) {
      params.push(rawParams.slice(start, i))
      start = i + 1
    }
  }

  params.push(rawParams.slice(start))
  return params
}

const getMainParams = (code: string, language: Exclude<CodeLanguage, typeof CodeLanguage.json>) => {
  const patterns: Record<Exclude<CodeLanguage, typeof CodeLanguage.json>, RegExp> = {
    [CodeLanguage.python3]: /def\s+main\s*\(/,
    [CodeLanguage.javascript]: /function\s+main\s*\(/,
  }
  const match = patterns[language].exec(code)
  if (!match) return undefined

  const start = match.index + match[0].length
  let nesting = 1
  let quote: string | undefined
  let escaped = false

  for (let i = start; i < code.length; i++) {
    const char = code[i]!

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (code.startsWith(quote, i)) {
        i += quote.length - 1
        quote = undefined
      }
      continue
    }

    if (char === '"' || char === "'" || (language === CodeLanguage.javascript && char === '`')) {
      quote =
        language === CodeLanguage.python3 && code.startsWith(char.repeat(3), i)
          ? char.repeat(3)
          : char
      i += quote.length - 1
    } else if (char === '(') {
      nesting++
    } else if (char === ')' && --nesting === 0) {
      return code.slice(start, i)
    }
  }

  return undefined
}

export const extractFunctionParams = (code: string, language: CodeLanguage) => {
  if (language === CodeLanguage.json) return []

  // Match strings first so comment markers inside them cannot consume real code.
  // This is lightweight filtering, not a full lexer: quotes in JavaScript regex
  // literals or nested template expressions can still confuse string boundaries.
  const commentPatterns = {
    [CodeLanguage.python3]:
      /"""(?:\\[\s\S]|[^\\])*?"""|'''(?:\\[\s\S]|[^\\])*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(#[^\r\n]*)/g,
    [CodeLanguage.javascript]:
      /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g,
  }
  const codeWithoutComments = code.replace(
    commentPatterns[language],
    (match: string, comment: string | undefined) =>
      comment ? comment.replace(/[^\r\n]/g, ' ') : match,
  )

  const params: string[] = []

  const functionParams = getMainParams(codeWithoutComments, language)
  if (functionParams) {
    // The JavaScript `main` is invoked as `main(inputs_obj)`, so its parameters are
    // usually written as a single destructuring pattern: `function main({ arg1, arg2 })`.
    const rawParams = functionParams.trim().replace(/^\{([\s\S]*)\}$/, '$1')

    params.push(
      ...splitTopLevelParams(rawParams, language)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.split(':')[0]!.trim()),
    )
  }

  return params
}
export const extractReturnType = (code: string, language: CodeLanguage): OutputVar => {
  const codeWithoutComments = code.replace(/\/\*\*[\s\S]*?\*\//, '')
  // console.log(codeWithoutComments)

  const returnIndex = codeWithoutComments.indexOf('return')
  if (returnIndex === -1) return {}

  // Extract the substring starting with 'return'.
  const codeAfterReturn = codeWithoutComments.slice(returnIndex)

  let bracketCount = 0
  let startIndex = codeAfterReturn.indexOf('{')

  if (language === CodeLanguage.javascript && startIndex === -1) {
    const parenStart = codeAfterReturn.indexOf('(')
    if (parenStart !== -1) startIndex = codeAfterReturn.indexOf('{', parenStart)
  }

  if (startIndex === -1) return {}

  let endIndex = -1

  for (let i = startIndex; i < codeAfterReturn.length; i++) {
    if (codeAfterReturn[i] === '{') bracketCount++
    if (codeAfterReturn[i] === '}') {
      bracketCount--
      if (bracketCount === 0) {
        endIndex = i + 1
        break
      }
    }
  }

  if (endIndex === -1) return {}

  const returnContent = codeAfterReturn.slice(startIndex + 1, endIndex - 1)
  // console.log(returnContent)

  const result: OutputVar = {}

  const keyRegex = /['"]?(\w+)['"]?\s*:(?![^{]*\})/g
  const matches = returnContent.matchAll(keyRegex)

  for (const match of matches) {
    // console.log(`Found key: "${match[1]}" from match: "${match[0]}"`)
    const key = match[1]
    result[key!] = {
      type: VarType.string,
      children: null,
    }
  }

  // console.log(result)

  return result
}
