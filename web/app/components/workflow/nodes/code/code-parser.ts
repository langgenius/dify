import type { OutputVar } from './types'
import { VarType } from '../../types'
import { CodeLanguage } from './types'

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

  const patterns: Record<Exclude<CodeLanguage, typeof CodeLanguage.json>, RegExp> = {
    [CodeLanguage.python3]: /def\s+main\s*\(([\s\S]*?)\)/,
    [CodeLanguage.javascript]: /function\s+main\s*\(([\s\S]*?)\)/,
  }
  const match = patterns[language].exec(codeWithoutComments)
  const params: string[] = []

  if (match?.[1]) {
    // The JavaScript `main` is invoked as `main(inputs_obj)`, so its parameters are
    // usually written as a single destructuring pattern: `function main({ arg1, arg2 })`.
    const rawParams = match[1].trim().replace(/^\{([\s\S]*)\}$/, '$1')

    params.push(
      ...rawParams
        .split(',')
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
