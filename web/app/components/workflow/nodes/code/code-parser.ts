import type { OutputVar } from './types'
import { parseExpressionAt, tokenizer } from 'acorn'
import { VarType } from '../../types'
import { CodeLanguage } from './types'

export const extractFunctionParams = (code: string, language: CodeLanguage) => {
  if (language === CodeLanguage.json) return []

  const patterns: Record<Exclude<CodeLanguage, typeof CodeLanguage.json>, RegExp> = {
    [CodeLanguage.python3]: /def\s+main\s*\((.*?)\)/,
    [CodeLanguage.javascript]: /function\s+main\s*\((.*?)\)/,
  }
  const match = patterns[language].exec(code)
  const params: string[] = []

  if (match?.[1]) {
    params.push(
      ...match[1]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.split(':')[0]!.trim()),
    )
  }

  return params
}

const extractJavaScriptReturnType = (code: string): OutputVar => {
  const options = { ecmaVersion: 'latest', allowAwaitOutsideFunction: true } as const
  try {
    for (const token of tokenizer(code, options)) {
      if (token.type.keyword !== 'return') continue

      const expression = parseExpressionAt(code, token.end, options)
      if (expression.type !== 'ObjectExpression') return {}

      const result: OutputVar = {}
      for (const property of expression.properties) {
        if (property.type !== 'Property' || property.computed) continue
        const key = property.key
        const name =
          key.type === 'Identifier'
            ? key.name
            : key.type === 'Literal' &&
                (typeof key.value === 'string' || typeof key.value === 'number')
              ? String(key.value)
              : undefined
        if (name) result[name] = { type: VarType.string, children: null }
      }
      return result
    }
  } catch {
    // Generated code can be incomplete; only infer outputs from a valid expression.
  }
  return {}
}

export const extractReturnType = (code: string, language: CodeLanguage): OutputVar => {
  if (language !== CodeLanguage.python3) return extractJavaScriptReturnType(code)

  // Preserve quoted Python values before removing comments.
  const commentsAndStrings = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|#[^\r\n]*/g
  const codeWithoutComments = code.replace(
    commentsAndStrings,
    (_match, literal: string | undefined) => literal ?? ' ',
  )

  const returnIndex = codeWithoutComments.indexOf('return')
  if (returnIndex === -1) return {}

  // Extract the substring starting with 'return'.
  const codeAfterReturn = codeWithoutComments.slice(returnIndex)

  let bracketCount = 0
  const startIndex = codeAfterReturn.indexOf('{')

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

  const result: OutputVar = {}

  // Split fields only at the outer object level; nested object keys are not outputs.
  let depth = 0
  let quote = ''
  let escaped = false
  let fieldStart = 0
  const addField = (field: string) => {
    const match = /^\s*(?:['"]([^'"]+)['"]|(\w+))\s*:/.exec(field)
    const key = match?.[1] ?? match?.[2]
    if (key) result[key] = { type: VarType.string, children: null }
  }
  for (let index = 0; index < returnContent.length; index++) {
    const char = returnContent[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if ('{[('.includes(char)) depth++
    else if ('}])'.includes(char)) depth--
    else if (char === ',' && depth === 0) {
      addField(returnContent.slice(fieldStart, index))
      fieldStart = index + 1
    }
  }
  addField(returnContent.slice(fieldStart))

  return result
}
