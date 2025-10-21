import { VarType } from '../../types'
import type { OutputVar } from './types'
import { CodeLanguage } from './types'

export const extractFunctionParams = (code: string, language: CodeLanguage) => {
  if (language === CodeLanguage.json)
    return []

  const patterns: Record<Exclude<CodeLanguage, CodeLanguage.json>, RegExp> = {
    [CodeLanguage.python3]: /def\s+main\s*\((.*?)\)/,
    [CodeLanguage.javascript]: /function\s+main\s*\((.*?)\)/,
  }
  const match = code.match(patterns[language])
  const params: string[] = []

  if (match?.[1]) {
    params.push(...match[1].split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => p.split(':')[0].trim()),
    )
  }

  return params
}
export const extractReturnType = (code: string, language: CodeLanguage): OutputVar => {
  const codeWithoutComments = code.replace(/\/\*\*[\s\S]*?\*\//, '')
  // console.log(codeWithoutComments)

  const returnIndex = codeWithoutComments.indexOf('return')
  if (returnIndex === -1)
    return {}

  // return から始まる部分文字列を取得
  const codeAfterReturn = codeWithoutComments.slice(returnIndex)

  let bracketCount = 0
  let startIndex = codeAfterReturn.indexOf('{')

  if (language === CodeLanguage.javascript && startIndex === -1) {
    const parenStart = codeAfterReturn.indexOf('(')
    if (parenStart !== -1)
      startIndex = codeAfterReturn.indexOf('{', parenStart)
  }

  if (startIndex === -1)
    return {}

  let endIndex = -1

  for (let i = startIndex; i < codeAfterReturn.length; i++) {
    if (codeAfterReturn[i] === '{')
      bracketCount++
    if (codeAfterReturn[i] === '}') {
      bracketCount--
      if (bracketCount === 0) {
        endIndex = i + 1
        break
      }
    }
  }

  if (endIndex === -1)
    return {}

  const returnContent = codeAfterReturn.slice(startIndex + 1, endIndex - 1)
  // console.log(returnContent)

  const result: OutputVar = {}

  const keyRegex = /['"]?(\w+)['"]?\s*:(?![^{]*})/g
  const matches = returnContent.matchAll(keyRegex)

  for (const match of matches) {
    // console.log(`Found key: "${match[1]}" from match: "${match[0]}"`)
    const key = match[1]
    result[key] = {
      type: VarType.string,
      children: null,
    }
  }

  // console.log(result)

  return result
}
