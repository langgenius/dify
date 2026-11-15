import type { AST, Rule, SourceCode } from 'eslint'
import type { AST as JsonAST } from 'jsonc-eslint-parser'

export type JsonRuleModule = Omit<Rule.RuleModule, 'create'> & {
  create: (context: Rule.RuleContext) => {
    [Type in JsonAST.JSONNode['type']]?: (node: Extract<JsonAST.JSONNode, { type: Type }>) => void
  }
}

type DisableDirective = {
  type: 'disable' | 'enable' | 'disable-next-line' | 'disable-line'
  value: string
  justification: string
  node: AST.Token
}

export function getDisableDirectives(sourceCode: SourceCode) {
  return (
    sourceCode as SourceCode & { getDisableDirectives: () => { directives: DisableDirective[] } }
  ).getDisableDirectives().directives
}

export const cleanJsonText = (text: string) => {
  const cleaned = text.replaceAll(/,\s*\}/g, '}')
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    return text
  }
}
