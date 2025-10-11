import type {
  ValueSelector,
} from '../types'
import type {
  BlockEnum,
} from '../types'
import { hasErrorHandleNode } from '.'

export const variableTransformer = (v: ValueSelector | string) => {
  if (typeof v === 'string')
    return v.replace(/^{{#|#}}$/g, '').split('.')

  return `{{#${v.join('.')}#}}`
}

export const isExceptionVariable = (variable: string, nodeType?: BlockEnum) => {
  return (variable === 'error_message' || variable === 'error_type') && hasErrorHandleNode(nodeType)
}
