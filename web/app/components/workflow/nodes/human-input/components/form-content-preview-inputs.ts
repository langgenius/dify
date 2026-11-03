import type { Field } from '../../llm/types'
import type { FormInputItem } from '../types'
import type {
  InputVar,
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { getInputVars } from '@/app/components/base/prompt-editor/constants'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { isENV } from '../../_base/components/variable/utils'
import { Type } from '../../llm/types'
import { getHumanInputFormDependencySelectors, isOutput } from '../utils'

type PreviewInputParams = {
  content: string
  formInputs: FormInputItem[]
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
}

const getSchemaVariable = (field: Field, path: string[]): Var => {
  const options = field.enum?.filter((value): value is string => typeof value === 'string')
  const type = (() => {
    switch (field.type) {
      case Type.number:
        return VarType.number
      case Type.boolean:
        return VarType.boolean
      case Type.object:
        return VarType.object
      case Type.file:
        return VarType.file
      case Type.array:
        return field.items?.type === Type.file ? VarType.arrayFile : VarType.array
      case Type.arrayString:
        return VarType.arrayString
      case Type.arrayNumber:
        return VarType.arrayNumber
      case Type.arrayObject:
        return VarType.arrayObject
      default:
        return VarType.string
    }
  })()
  return {
    variable: path.join('.'),
    type,
    isSelect: !!options?.length && options.length === field.enum?.length,
    options,
  }
}

const findVariable = (variables: Var[], path: string[]): Var | undefined => {
  // Metadata can contain relative child names or flattened names such as sys.query.
  for (let length = path.length; length > 0; length--) {
    const variable = variables.find((item) => item.variable === path.slice(0, length).join('.'))
    if (!variable) continue
    if (length === path.length) return variable

    const remainingPath = path.slice(length)
    if (Array.isArray(variable.children)) return findVariable(variable.children, remainingPath)
    if (!variable.children) continue

    let properties = variable.children.schema.properties
    let field: Field | undefined
    for (const key of remainingPath) {
      field = properties?.[key]
      if (!field) break
      properties = field.properties ?? {}
    }
    if (field) return getSchemaVariable(field, remainingPath)
  }
  return undefined
}

const getInputType = (variable?: Var): InputVarType => {
  if (variable?.isSelect) return InputVarType.select
  if (variable?.isParagraph) return InputVarType.paragraph
  switch (variable?.type) {
    case VarType.number:
    case VarType.integer:
      return InputVarType.number
    case VarType.boolean:
      return InputVarType.checkbox
    case VarType.object:
    case VarType.array:
    case VarType.arrayString:
    case VarType.arrayNumber:
    case VarType.arrayObject:
    case VarType.arrayBoolean:
    case VarType.arrayAny:
      return InputVarType.json
    case VarType.file:
      return InputVarType.singleFile
    case VarType.arrayFile:
      return InputVarType.multiFiles
    default:
      return InputVarType.textInput
  }
}

export const getHumanInputPreviewInputs = ({
  content,
  formInputs,
  availableVars,
  availableNodes,
}: PreviewInputParams): InputVar[] => {
  const selectors = new Map<string, ValueSelector>()
  for (const selector of [
    ...getInputVars(content),
    ...getHumanInputFormDependencySelectors(formInputs),
  ]) {
    if (selector.length < 2 || isOutput(selector) || isENV(selector)) continue
    selectors.set(selector.join('.'), selector)
  }

  return Array.from(selectors.values(), (selector) => {
    let group = availableVars.find((item) => item.nodeId === selector[0])
    let variable = group
      ? (findVariable(group.vars, selector.slice(1)) ?? findVariable(group.vars, selector))
      : undefined
    if (!variable) {
      group = availableVars.find((item) => findVariable(item.vars, selector))
      variable = group ? findVariable(group.vars, selector) : undefined
    }
    const node = availableNodes.find((item) => item.id === selector[0])
    const path = selector.join('.')
    const nodeName = node?.data.title || group?.title || selector[0] || path
    const type = getInputType(variable)
    return {
      variable: `#${path}#`,
      value_selector: selector,
      label:
        node && type !== InputVarType.checkbox
          ? {
              nodeType: node.data.type,
              nodeName,
              variable: selector.slice(1).join('.'),
              isChatVar: selector[0] === 'conversation',
            }
          : `${nodeName} · ${path}`,
      type,
      required: true,
      ...(variable?.options ? { options: variable.options } : {}),
    }
  })
}
