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
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import type { VariableAssignerNodeType } from '@/app/components/workflow/nodes/variable-assigner/types'
import {
  HTTP_REQUEST_OUTPUT_STRUCT,
  KNOWLEDGE_RETRIEVAL_OUTPUT_STRUCT,
  LLM_OUTPUT_STRUCT,
  QUESTION_CLASSIFIER_OUTPUT_STRUCT,
  SUPPORT_OUTPUT_VARS_NODE,
  TEMPLATE_TRANSFORM_OUTPUT_STRUCT,
  TOOL_OUTPUT_STRUCT,
} from '@/app/components/workflow/constants'
import type { PromptItem } from '@/models/debug'
import { VAR_REGEX } from '@/config'

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
      } = data as VariableAssignerNodeType
      res.vars = [
        {
          variable: 'output',
          type: output_type,
        },
      ]
      break
    }

    case BlockEnum.Tool: {
      res.vars = TOOL_OUTPUT_STRUCT
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

export const isSystemVar = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'sys' || valueSelector[1] === 'sys'
}

export const getNodeInfoById = (nodes: any, id: string) => {
  if (!isArray(nodes))
    return
  return nodes.find((node: any) => node.id === id)
}

export const getVarType = (value: ValueSelector, availableNodes: any[], isChatMode: boolean): VarType | undefined => {
  const isSystem = isSystemVar(value)
  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })
  const allOutputVars = toNodeOutputVars(availableNodes, isChatMode)

  const targetVarNodeId = isSystem ? startNode?.id : value[0]
  const targetVar = allOutputVars.find(v => v.nodeId === targetVarNodeId)

  if (!targetVar)
    return undefined

  let type: VarType = VarType.string
  let curr: any = targetVar.vars
  if (isSystem) {
    return curr.find((v: any) => v.variable === (value as ValueSelector).join('.'))?.type
  }
  else {
    (value as ValueSelector).slice(1).forEach((key, i) => {
      const isLast = i === value.length - 2
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
      res = [(data as QuestionClassifierNodeType).query_variable_selector]
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
    }
  }
  return res || []
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

    case BlockEnum.Tool: {
      varsToValueSelectorList(TOOL_OUTPUT_STRUCT, [id], res)
      break
    }
  }

  return res
}
