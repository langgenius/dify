import produce from 'immer'
import { isArray, uniq } from 'lodash-es'
import type { CodeNodeType } from '../../../code/types'
import type { EndNodeType } from '../../../end/types'
import type { AnswerNodeType } from '../../../answer/types'
import type { LLMNodeType } from '../../../llm/types'
import type { KnowledgeRetrievalNodeType } from '../../../knowledge-retrieval/types'
import type { IfElseNodeType } from '../../../if-else/types'
import type { TemplateTransformNodeType } from '../../../template-transform/types'
import type { QuestionClassifierNodeType } from '../../../question-classifier/types'
import type { HttpNodeType } from '../../../http/types'
import { VarType as ToolVarType } from '../../../tool/types'
import type { ToolNodeType } from '../../../tool/types'
import type { ParameterExtractorNodeType } from '../../../parameter-extractor/types'
import type { IterationNodeType } from '../../../iteration/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import type { VariableAssignerNodeType } from '@/app/components/workflow/nodes/variable-assigner/types'
import {
  HTTP_REQUEST_OUTPUT_STRUCT,
  KNOWLEDGE_RETRIEVAL_OUTPUT_STRUCT,
  LLM_OUTPUT_STRUCT,
  PARAMETER_EXTRACTOR_COMMON_STRUCT,
  QUESTION_CLASSIFIER_OUTPUT_STRUCT,
  SUPPORT_OUTPUT_VARS_NODE,
  TEMPLATE_TRANSFORM_OUTPUT_STRUCT,
  TOOL_OUTPUT_STRUCT,
} from '@/app/components/workflow/constants'
import type { PromptItem } from '@/models/debug'
import { VAR_REGEX } from '@/config'

export const isSystemVar = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'sys' || valueSelector[1] === 'sys'
}

const inputVarTypeToVarType = (type: InputVarType): VarType => {
  if (type === InputVarType.number)
    return VarType.number

  return VarType.string
}

const findExceptVarInObject = (obj: any, filterVar: (payload: Var, selector: ValueSelector) => boolean, value_selector: ValueSelector): Var => {
  const { children } = obj
  const res: Var = {
    variable: obj.variable,
    type: VarType.object,
    children: children.filter((item: Var) => {
      const { children } = item
      const currSelector = [...value_selector, item.variable]
      if (!children)
        return filterVar(item, currSelector)

      const obj = findExceptVarInObject(item, filterVar, currSelector)
      return obj.children && obj.children?.length > 0
    }),
  }
  return res
}

const formatItem = (item: any, isChatMode: boolean, filterVar: (payload: Var, selector: ValueSelector) => boolean): NodeOutPutVar => {
  const { id, data } = item

  const res: NodeOutPutVar = {
    nodeId: id,
    title: data.title,
    vars: [],
  }
  switch (data.type) {
    case BlockEnum.Start: {
      const {
        variables,
      } = data as StartNodeType
      res.vars = variables.map((v) => {
        return {
          variable: v.variable,
          type: inputVarTypeToVarType(v.type),
          isParagraph: v.type === InputVarType.paragraph,
          isSelect: v.type === InputVarType.select,
          options: v.options,
          required: v.required,
        }
      })
      if (isChatMode) {
        res.vars.push({
          variable: 'sys.query',
          type: VarType.string,
        })
        res.vars.push({
          variable: 'sys.conversation_id',
          type: VarType.string,
        })
      }
      res.vars.push({
        variable: 'sys.user_id',
        type: VarType.string,
      })
      res.vars.push({
        variable: 'sys.files',
        type: VarType.arrayFile,
      })
      break
    }

    case BlockEnum.LLM: {
      res.vars = LLM_OUTPUT_STRUCT
      break
    }

    case BlockEnum.KnowledgeRetrieval: {
      res.vars = KNOWLEDGE_RETRIEVAL_OUTPUT_STRUCT
      break
    }

    case BlockEnum.Code: {
      const {
        outputs,
      } = data as CodeNodeType
      res.vars = Object.keys(outputs).map((key) => {
        return {
          variable: key,
          type: outputs[key].type,
        }
      })
      break
    }

    case BlockEnum.TemplateTransform: {
      res.vars = TEMPLATE_TRANSFORM_OUTPUT_STRUCT
      break
    }

    case BlockEnum.QuestionClassifier: {
      res.vars = QUESTION_CLASSIFIER_OUTPUT_STRUCT
      break
    }

    case BlockEnum.HttpRequest: {
      res.vars = HTTP_REQUEST_OUTPUT_STRUCT
      break
    }

    case BlockEnum.VariableAssigner: {
      const {
        output_type,
        advanced_settings,
      } = data as VariableAssignerNodeType
      const isGroup = !!advanced_settings?.group_enabled
      if (!isGroup) {
        res.vars = [
          {
            variable: 'output',
            type: output_type,
          },
        ]
      }
      else {
        res.vars = advanced_settings?.groups.map((group) => {
          return {
            variable: group.group_name,
            type: VarType.object,
            children: [{
              variable: 'output',
              type: group.output_type,
            }],
          }
        })
      }
      break
    }

    case BlockEnum.VariableAggregator: {
      const {
        output_type,
        advanced_settings,
      } = data as VariableAssignerNodeType
      const isGroup = !!advanced_settings?.group_enabled
      if (!isGroup) {
        res.vars = [
          {
            variable: 'output',
            type: output_type,
          },
        ]
      }
      else {
        res.vars = advanced_settings?.groups.map((group) => {
          return {
            variable: group.group_name,
            type: VarType.object,
            children: [{
              variable: 'output',
              type: group.output_type,
            }],
          }
        })
      }
      break
    }

    case BlockEnum.Tool: {
      res.vars = TOOL_OUTPUT_STRUCT
      break
    }

    case BlockEnum.ParameterExtractor: {
      res.vars = [
        ...((data as ParameterExtractorNodeType).parameters || []).map((p) => {
          return {
            variable: p.name,
            type: p.type as unknown as VarType,
          }
        }),
        ...PARAMETER_EXTRACTOR_COMMON_STRUCT,
      ]
      break
    }

    case BlockEnum.Iteration: {
      res.vars = [
        {
          variable: 'output',
          type: (data as IterationNodeType).output_type || VarType.arrayString,
        },
      ]
      break
    }
  }

  const selector = [id]
  res.vars = res.vars.filter((v) => {
    const { children } = v
    if (!children)
      return filterVar(v, selector)

    const obj = findExceptVarInObject(v, filterVar, selector)
    return obj?.children && obj?.children.length > 0
  }).map((v) => {
    const { children } = v
    if (!children)
      return v

    return findExceptVarInObject(v, filterVar, selector)
  })

  return res
}
export const toNodeOutputVars = (nodes: any[], isChatMode: boolean, filterVar = (_payload: Var, _selector: ValueSelector) => true): NodeOutPutVar[] => {
  const res = nodes
    .filter(node => SUPPORT_OUTPUT_VARS_NODE.includes(node.data.type))
    .map((node) => {
      return {
        ...formatItem(node, isChatMode, filterVar),
        isStartNode: node.data.type === BlockEnum.Start,
      }
    })
    .filter(item => item.vars.length > 0)
  return res
}

const getIterationItemType = ({
  valueSelector,
  beforeNodesOutputVars,
}: {
  valueSelector: ValueSelector
  beforeNodesOutputVars: NodeOutPutVar[]
}): VarType => {
  const outputVarNodeId = valueSelector[0]
  const targetVar = beforeNodesOutputVars.find(v => v.nodeId === outputVarNodeId)
  if (!targetVar)
    return VarType.string

  let arrayType: VarType = VarType.string

  const isSystem = isSystemVar(valueSelector)
  let curr: any = targetVar.vars

  if (isSystem)
    return curr.find((v: any) => v.variable === (valueSelector).join('.'))?.type;

  (valueSelector).slice(1).forEach((key, i) => {
    const isLast = i === valueSelector.length - 2
    curr = curr?.find((v: any) => v.variable === key)
    if (isLast) {
      arrayType = curr?.type
    }
    else {
      if (curr?.type === VarType.object)
        curr = curr.children
    }
  })
  switch (arrayType as VarType) {
    case VarType.arrayString:
      return VarType.string
    case VarType.arrayNumber:
      return VarType.number
    case VarType.arrayObject:
      return VarType.object
    case VarType.array:
      return VarType.any
    case VarType.arrayFile:
      return VarType.object
    default:
      return VarType.string
  }
}

export const getVarType = ({
  parentNode,
  valueSelector,
  isIterationItem,
  availableNodes,
  isChatMode,
  isConstant,
}:
{
  valueSelector: ValueSelector
  parentNode?: Node | null
  isIterationItem?: boolean
  availableNodes: any[]
  isChatMode: boolean
  isConstant?: boolean
}): VarType => {
  if (isConstant)
    return VarType.string

  const beforeNodesOutputVars = toNodeOutputVars(availableNodes, isChatMode)

  const isIterationInnerVar = parentNode?.data.type === BlockEnum.Iteration
  if (isIterationItem) {
    return getIterationItemType({
      valueSelector,
      beforeNodesOutputVars,
    })
  }
  if (isIterationInnerVar) {
    if (valueSelector[1] === 'item') {
      const itemType = getIterationItemType({
        valueSelector: (parentNode?.data as any).iterator_selector || [],
        beforeNodesOutputVars,
      })
      return itemType
    }
    if (valueSelector[1] === 'index')
      return VarType.number

    return VarType.string
  }
  const isSystem = isSystemVar(valueSelector)
  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })

  const targetVarNodeId = isSystem ? startNode?.id : valueSelector[0]
  const targetVar = beforeNodesOutputVars.find(v => v.nodeId === targetVarNodeId)

  if (!targetVar)
    return VarType.string

  let type: VarType = VarType.string
  let curr: any = targetVar.vars
  if (isSystem) {
    return curr.find((v: any) => v.variable === (valueSelector as ValueSelector).join('.'))?.type
  }
  else {
    (valueSelector as ValueSelector).slice(1).forEach((key, i) => {
      const isLast = i === valueSelector.length - 2
      curr = curr.find((v: any) => v.variable === key)
      if (isLast) {
        type = curr?.type
      }
      else {
        if (curr.type === VarType.object)
          curr = curr.children
      }
    })
    return type
  }
}

// node output vars + parent inner vars(if in iteration or other wrap node)
export const toNodeAvailableVars = ({
  parentNode,
  t,
  beforeNodes,
  isChatMode,
  filterVar,
}: {
  parentNode?: Node | null
  t?: any
  // to get those nodes output vars
  beforeNodes: Node[]
  isChatMode: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
}): NodeOutPutVar[] => {
  const beforeNodesOutputVars = toNodeOutputVars(beforeNodes, isChatMode, filterVar)
  const isInIteration = parentNode?.data.type === BlockEnum.Iteration
  if (isInIteration) {
    const iterationNode: any = parentNode
    const itemType = getVarType({
      parentNode: iterationNode,
      isIterationItem: true,
      valueSelector: iterationNode?.data.iterator_selector || [],
      availableNodes: beforeNodes,
      isChatMode,
    })
    const iterationVar = {
      nodeId: iterationNode?.id,
      title: t('workflow.nodes.iteration.currentIteration'),
      vars: [
        {
          variable: 'item',
          type: itemType,
        },
        {
          variable: 'index',
          type: VarType.number,
        },
      ],
    }
    beforeNodesOutputVars.unshift(iterationVar)
  }
  return beforeNodesOutputVars
}

export const getNodeInfoById = (nodes: any, id: string) => {
  if (!isArray(nodes))
    return
  return nodes.find((node: any) => node.id === id)
}

const matchNotSystemVars = (prompts: string[]) => {
  if (!prompts)
    return []

  const allVars: string[] = []
  prompts.forEach((prompt) => {
    VAR_REGEX.lastIndex = 0
    if (typeof prompt !== 'string')
      return
    allVars.push(...(prompt.match(VAR_REGEX) || []))
  })
  const uniqVars = uniq(allVars).map(v => v.replaceAll('{{#', '').replace('#}}', '').split('.'))
  return uniqVars
}

const replaceOldVarInText = (text: string, oldVar: ValueSelector, newVar: ValueSelector) => {
  if (!text || typeof text !== 'string')
    return text

  if (!newVar || newVar.length === 0)
    return text

  return text.replaceAll(`{{#${oldVar.join('.')}#}}`, `{{#${newVar.join('.')}#}}`)
}

export const getNodeUsedVars = (node: Node): ValueSelector[] => {
  const { data } = node
  const { type } = data
  let res: ValueSelector[] = []
  switch (type) {
    case BlockEnum.End: {
      res = (data as EndNodeType).outputs?.map((output) => {
        return output.value_selector
      })
      break
    }
    case BlockEnum.Answer: {
      res = (data as AnswerNodeType).variables?.map((v) => {
        return v.value_selector
      })
      break
    }
    case BlockEnum.LLM: {
      const payload = (data as LLMNodeType)
      const isChatModel = payload.model?.mode === 'chat'
      let prompts: string[] = []
      if (isChatModel) {
        prompts = (payload.prompt_template as PromptItem[])?.map(p => p.text) || []
        if (payload.memory?.query_prompt_template)
          prompts.push(payload.memory.query_prompt_template)
      }
      else { prompts = [(payload.prompt_template as PromptItem).text] }

      const inputVars: ValueSelector[] = matchNotSystemVars(prompts)
      const contextVar = (data as LLMNodeType).context?.variable_selector ? [(data as LLMNodeType).context?.variable_selector] : []
      res = [...inputVars, ...contextVar]
      break
    }
    case BlockEnum.KnowledgeRetrieval: {
      res = [(data as KnowledgeRetrievalNodeType).query_variable_selector]
      break
    }
    case BlockEnum.IfElse: {
      res = (data as IfElseNodeType).conditions?.map((c) => {
        return c.variable_selector
      })
      break
    }
    case BlockEnum.Code: {
      res = (data as CodeNodeType).variables?.map((v) => {
        return v.value_selector
      })
      break
    }
    case BlockEnum.TemplateTransform: {
      res = (data as TemplateTransformNodeType).variables?.map((v: any) => {
        return v.value_selector
      })
      break
    }
    case BlockEnum.QuestionClassifier: {
      const payload = (data as QuestionClassifierNodeType)
      res = [payload.query_variable_selector]
      const varInInstructions = matchNotSystemVars([payload.instruction || ''])
      res.push(...varInInstructions)
      break
    }
    case BlockEnum.HttpRequest: {
      const payload = (data as HttpNodeType)
      res = matchNotSystemVars([payload.url, payload.headers, payload.params, payload.body.data])
      break
    }
    case BlockEnum.Tool: {
      const payload = (data as ToolNodeType)
      const mixVars = matchNotSystemVars(Object.keys(payload.tool_parameters)?.filter(key => payload.tool_parameters[key].type === ToolVarType.mixed).map(key => payload.tool_parameters[key].value) as string[])
      const vars = Object.keys(payload.tool_parameters).filter(key => payload.tool_parameters[key].type === ToolVarType.variable).map(key => payload.tool_parameters[key].value as string) || []
      res = [...(mixVars as ValueSelector[]), ...(vars as any)]
      break
    }

    case BlockEnum.VariableAssigner: {
      res = (data as VariableAssignerNodeType)?.variables
      break
    }

    case BlockEnum.VariableAggregator: {
      res = (data as VariableAssignerNodeType)?.variables
      break
    }

    case BlockEnum.ParameterExtractor: {
      const payload = (data as ParameterExtractorNodeType)
      res = [payload.query]
      const varInInstructions = matchNotSystemVars([payload.instruction || ''])
      res.push(...varInInstructions)
      break
    }

    case BlockEnum.Iteration: {
      res = [(data as IterationNodeType).iterator_selector]
      break
    }
  }
  return res || []
}

// used can be used in iteration node
export const getNodeUsedVarPassToServerKey = (node: Node, valueSelector: ValueSelector): string | string[] => {
  const { data } = node
  const { type } = data
  let res: string | string[] = ''
  switch (type) {
    case BlockEnum.LLM: {
      const payload = (data as LLMNodeType)
      res = [`#${valueSelector.join('.')}#`]
      if (payload.context?.variable_selector.join('.') === valueSelector.join('.'))
        res.push('#context#')

      break
    }
    case BlockEnum.KnowledgeRetrieval: {
      res = 'query'
      break
    }
    case BlockEnum.IfElse: {
      const targetVar = (data as IfElseNodeType).conditions?.find(c => c.variable_selector.join('.') === valueSelector.join('.'))
      if (targetVar)
        res = `#${valueSelector.join('.')}#`
      break
    }
    case BlockEnum.Code: {
      const targetVar = (data as CodeNodeType).variables?.find(v => v.value_selector.join('.') === valueSelector.join('.'))
      if (targetVar)
        res = targetVar.variable
      break
    }
    case BlockEnum.TemplateTransform: {
      const targetVar = (data as TemplateTransformNodeType).variables?.find(v => v.value_selector.join('.') === valueSelector.join('.'))
      if (targetVar)
        res = targetVar.variable
      break
    }
    case BlockEnum.QuestionClassifier: {
      res = 'query'
      break
    }
    case BlockEnum.HttpRequest: {
      res = `#${valueSelector.join('.')}#`
      break
    }

    case BlockEnum.Tool: {
      res = `#${valueSelector.join('.')}#`
      break
    }

    case BlockEnum.VariableAssigner: {
      res = `#${valueSelector.join('.')}#`
      break
    }

    case BlockEnum.VariableAggregator: {
      res = `#${valueSelector.join('.')}#`
      break
    }

    case BlockEnum.ParameterExtractor: {
      res = 'query'
      break
    }
  }
  return res
}

export const findUsedVarNodes = (varSelector: ValueSelector, availableNodes: Node[]): Node[] => {
  const res: Node[] = []
  availableNodes.forEach((node) => {
    const vars = getNodeUsedVars(node)
    if (vars.find(v => v.join('.') === varSelector.join('.')))
      res.push(node)
  })
  return res
}

export const updateNodeVars = (oldNode: Node, oldVarSelector: ValueSelector, newVarSelector: ValueSelector): Node => {
  const newNode = produce(oldNode, (draft: any) => {
    const { data } = draft
    const { type } = data

    switch (type) {
      case BlockEnum.End: {
        const payload = data as EndNodeType
        if (payload.outputs) {
          payload.outputs = payload.outputs.map((output) => {
            if (output.value_selector.join('.') === oldVarSelector.join('.'))
              output.value_selector = newVarSelector
            return output
          })
        }
        break
      }
      case BlockEnum.Answer: {
        const payload = data as AnswerNodeType
        if (payload.variables) {
          payload.variables = payload.variables.map((v) => {
            if (v.value_selector.join('.') === oldVarSelector.join('.'))
              v.value_selector = newVarSelector
            return v
          })
        }
        break
      }
      case BlockEnum.LLM: {
        const payload = data as LLMNodeType
        const isChatModel = payload.model?.mode === 'chat'
        if (isChatModel) {
          payload.prompt_template = (payload.prompt_template as PromptItem[]).map((prompt) => {
            return {
              ...prompt,
              text: replaceOldVarInText(prompt.text, oldVarSelector, newVarSelector),
            }
          })
          if (payload.memory?.query_prompt_template)
            payload.memory.query_prompt_template = replaceOldVarInText(payload.memory.query_prompt_template, oldVarSelector, newVarSelector)
        }
        else {
          payload.prompt_template = {
            ...payload.prompt_template,
            text: replaceOldVarInText((payload.prompt_template as PromptItem).text, oldVarSelector, newVarSelector),
          }
        }
        if (payload.context?.variable_selector?.join('.') === oldVarSelector.join('.'))
          payload.context.variable_selector = newVarSelector

        break
      }
      case BlockEnum.KnowledgeRetrieval: {
        const payload = data as KnowledgeRetrievalNodeType
        if (payload.query_variable_selector.join('.') === oldVarSelector.join('.'))
          payload.query_variable_selector = newVarSelector
        break
      }
      case BlockEnum.IfElse: {
        const payload = data as IfElseNodeType
        if (payload.conditions) {
          payload.conditions = payload.conditions.map((c) => {
            if (c.variable_selector.join('.') === oldVarSelector.join('.'))
              c.variable_selector = newVarSelector
            return c
          })
        }
        break
      }
      case BlockEnum.Code: {
        const payload = data as CodeNodeType
        if (payload.variables) {
          payload.variables = payload.variables.map((v) => {
            if (v.value_selector.join('.') === oldVarSelector.join('.'))
              v.value_selector = newVarSelector
            return v
          })
        }
        break
      }
      case BlockEnum.TemplateTransform: {
        const payload = data as TemplateTransformNodeType
        if (payload.variables) {
          payload.variables = payload.variables.map((v: any) => {
            if (v.value_selector.join('.') === oldVarSelector.join('.'))
              v.value_selector = newVarSelector
            return v
          })
        }
        break
      }
      case BlockEnum.QuestionClassifier: {
        const payload = data as QuestionClassifierNodeType
        if (payload.query_variable_selector.join('.') === oldVarSelector.join('.'))
          payload.query_variable_selector = newVarSelector
        payload.instruction = replaceOldVarInText(payload.instruction, oldVarSelector, newVarSelector)
        break
      }
      case BlockEnum.HttpRequest: {
        const payload = data as HttpNodeType
        payload.url = replaceOldVarInText(payload.url, oldVarSelector, newVarSelector)
        payload.headers = replaceOldVarInText(payload.headers, oldVarSelector, newVarSelector)
        payload.params = replaceOldVarInText(payload.params, oldVarSelector, newVarSelector)
        payload.body.data = replaceOldVarInText(payload.body.data, oldVarSelector, newVarSelector)
        break
      }
      case BlockEnum.Tool: {
        const payload = data as ToolNodeType
        const hasShouldRenameVar = Object.keys(payload.tool_parameters)?.filter(key => payload.tool_parameters[key].type !== ToolVarType.constant)
        if (hasShouldRenameVar) {
          Object.keys(payload.tool_parameters).forEach((key) => {
            const value = payload.tool_parameters[key]
            const { type } = value
            if (type === ToolVarType.variable) {
              payload.tool_parameters[key] = {
                ...value,
                value: newVarSelector,
              }
            }

            if (type === ToolVarType.mixed) {
              payload.tool_parameters[key] = {
                ...value,
                value: replaceOldVarInText(payload.tool_parameters[key].value as string, oldVarSelector, newVarSelector),
              }
            }
          })
        }
        break
      }
      case BlockEnum.VariableAssigner: {
        const payload = data as VariableAssignerNodeType
        if (payload.variables) {
          payload.variables = payload.variables.map((v) => {
            if (v.join('.') === oldVarSelector.join('.'))
              v = newVarSelector
            return v
          })
        }
        break
      }
      case BlockEnum.VariableAggregator: {
        const payload = data as VariableAssignerNodeType
        if (payload.variables) {
          payload.variables = payload.variables.map((v) => {
            if (v.join('.') === oldVarSelector.join('.'))
              v = newVarSelector
            return v
          })
        }
        break
      }
      case BlockEnum.ParameterExtractor: {
        const payload = data as ParameterExtractorNodeType
        if (payload.query.join('.') === oldVarSelector.join('.'))
          payload.query = newVarSelector
        payload.instruction = replaceOldVarInText(payload.instruction, oldVarSelector, newVarSelector)
        break
      }
      case BlockEnum.Iteration: {
        const payload = data as IterationNodeType
        if (payload.iterator_selector.join('.') === oldVarSelector.join('.'))
          payload.iterator_selector = newVarSelector

        break
      }
    }
  })
  return newNode
}
const varToValueSelectorList = (v: Var, parentValueSelector: ValueSelector, res: ValueSelector[]) => {
  if (!v.variable)
    return

  res.push([...parentValueSelector, v.variable])

  if (v.children && v.children.length > 0) {
    v.children.forEach((child) => {
      varToValueSelectorList(child, [...parentValueSelector, v.variable], res)
    })
  }
}

const varsToValueSelectorList = (vars: Var | Var[], parentValueSelector: ValueSelector, res: ValueSelector[]) => {
  if (Array.isArray(vars)) {
    vars.forEach((v) => {
      varToValueSelectorList(v, parentValueSelector, res)
    })
  }
  varToValueSelectorList(vars as Var, parentValueSelector, res)
}

export const getNodeOutputVars = (node: Node, isChatMode: boolean): ValueSelector[] => {
  const { data, id } = node
  const { type } = data
  let res: ValueSelector[] = []

  switch (type) {
    case BlockEnum.Start: {
      const {
        variables,
      } = data as StartNodeType
      res = variables.map((v) => {
        return [id, v.variable]
      })

      if (isChatMode) {
        res.push([id, 'sys', 'query'])
        res.push([id, 'sys', 'files'])
      }
      break
    }

    case BlockEnum.LLM: {
      varsToValueSelectorList(LLM_OUTPUT_STRUCT, [id], res)
      break
    }

    case BlockEnum.KnowledgeRetrieval: {
      varsToValueSelectorList(KNOWLEDGE_RETRIEVAL_OUTPUT_STRUCT, [id], res)
      break
    }

    case BlockEnum.Code: {
      const {
        outputs,
      } = data as CodeNodeType
      Object.keys(outputs).forEach((key) => {
        res.push([id, key])
      })
      break
    }

    case BlockEnum.TemplateTransform: {
      varsToValueSelectorList(TEMPLATE_TRANSFORM_OUTPUT_STRUCT, [id], res)
      break
    }

    case BlockEnum.QuestionClassifier: {
      varsToValueSelectorList(QUESTION_CLASSIFIER_OUTPUT_STRUCT, [id], res)
      break
    }

    case BlockEnum.HttpRequest: {
      varsToValueSelectorList(HTTP_REQUEST_OUTPUT_STRUCT, [id], res)
      break
    }

    case BlockEnum.VariableAssigner: {
      res.push([id, 'output'])
      break
    }

    case BlockEnum.VariableAggregator: {
      res.push([id, 'output'])
      break
    }

    case BlockEnum.Tool: {
      varsToValueSelectorList(TOOL_OUTPUT_STRUCT, [id], res)
      break
    }

    case BlockEnum.ParameterExtractor: {
      const {
        parameters,
      } = data as ParameterExtractorNodeType
      if (parameters?.length > 0) {
        parameters.forEach((p) => {
          res.push([id, p.name])
        })
      }

      break
    }

    case BlockEnum.Iteration: {
      res.push([id, 'output'])
      break
    }
  }

  return res
}
