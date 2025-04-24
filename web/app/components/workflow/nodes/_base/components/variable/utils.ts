import produce from 'immer'
import { isArray, uniq } from 'lodash-es'
import type { CodeNodeType } from '../../../code/types'
import type { EndNodeType } from '../../../end/types'
import type { AnswerNodeType } from '../../../answer/types'
import { type LLMNodeType, type StructuredOutput, Type } from '../../../llm/types'
import type { KnowledgeRetrievalNodeType } from '../../../knowledge-retrieval/types'
import type { IfElseNodeType } from '../../../if-else/types'
import type { TemplateTransformNodeType } from '../../../template-transform/types'
import type { QuestionClassifierNodeType } from '../../../question-classifier/types'
import type { HttpNodeType } from '../../../http/types'
import { VarType as ToolVarType } from '../../../tool/types'
import type { ToolNodeType } from '../../../tool/types'
import type { ParameterExtractorNodeType } from '../../../parameter-extractor/types'
import type { IterationNodeType } from '../../../iteration/types'
import type { LoopNodeType } from '../../../loop/types'
import type { ListFilterNodeType } from '../../../list-operator/types'
import { OUTPUT_FILE_SUB_VARIABLES } from '../../../constants'
import type { DocExtractorNodeType } from '../../../document-extractor/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { ConversationVariable, EnvironmentVariable, Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import type { VariableAssignerNodeType } from '@/app/components/workflow/nodes/variable-assigner/types'
import type { Field as StructField } from '@/app/components/workflow/nodes/llm/types'

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
import type { AgentNodeType } from '../../../agent/types'

export const isSystemVar = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'sys' || valueSelector[1] === 'sys'
}

export const isENV = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'env'
}

export const isConversationVar = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'conversation'
}

const inputVarTypeToVarType = (type: InputVarType): VarType => {
  return ({
    [InputVarType.number]: VarType.number,
    [InputVarType.singleFile]: VarType.file,
    [InputVarType.multiFiles]: VarType.arrayFile,
  } as any)[type] || VarType.string
}

const structTypeToVarType = (type: Type, isArray?: boolean): VarType => {
  if (isArray) {
    return ({
      [Type.string]: VarType.arrayString,
      [Type.number]: VarType.arrayNumber,
      [Type.object]: VarType.arrayObject,
    } as any)[type] || VarType.string
  }
  return ({
    [Type.string]: VarType.string,
    [Type.number]: VarType.number,
    [Type.boolean]: VarType.boolean,
    [Type.object]: VarType.object,
    [Type.array]: VarType.array,
  } as any)[type] || VarType.string
}

export const varTypeToStructType = (type: VarType): Type => {
  return ({
    [VarType.string]: Type.string,
    [VarType.number]: Type.number,
    [VarType.boolean]: Type.boolean,
    [VarType.object]: Type.object,
    [VarType.array]: Type.array,
  } as any)[type] || Type.string
}

const findExceptVarInStructuredProperties = (properties: Record<string, StructField>, filterVar: (payload: Var, selector: ValueSelector) => boolean): Record<string, StructField> => {
  const res = produce(properties, (draft) => {
    Object.keys(properties).forEach((key) => {
      const item = properties[key]
      const isObj = item.type === Type.object
      const isArray = item.type === Type.array
      const arrayType = item.items?.type

      if (!isObj && !filterVar({
        variable: key,
        type: structTypeToVarType(isArray ? arrayType! : item.type, isArray),
      }, [key])) {
        delete properties[key]
        return
      }
      if (item.type === Type.object && item.properties)
        item.properties = findExceptVarInStructuredProperties(item.properties, filterVar)
    })
    return draft
  })
  return res
}

const findExceptVarInStructuredOutput = (structuredOutput: StructuredOutput, filterVar: (payload: Var, selector: ValueSelector) => boolean): StructuredOutput => {
  const res = produce(structuredOutput, (draft) => {
    const properties = draft.schema.properties
    Object.keys(properties).forEach((key) => {
      const item = properties[key]
      const isObj = item.type === Type.object
      const isArray = item.type === Type.array
      const arrayType = item.items?.type
      if (!isObj && !filterVar({
        variable: key,
        type: structTypeToVarType(isArray ? arrayType! : item.type, isArray),
      }, [key])) {
        delete properties[key]
        return
      }
      if (item.type === Type.object && item.properties)
        item.properties = findExceptVarInStructuredProperties(item.properties, filterVar)
    })
    return draft
  })
  return res
}

const findExceptVarInObject = (obj: any, filterVar: (payload: Var, selector: ValueSelector) => boolean, value_selector: ValueSelector, isFile?: boolean): Var => {
  const { children } = obj
  const isStructuredOutput = !!(children as StructuredOutput)?.schema?.properties

  const res: Var = {
    variable: obj.variable,
    type: isFile ? VarType.file : VarType.object,
    children: isStructuredOutput ? findExceptVarInStructuredOutput(children, filterVar) : children.filter((item: Var) => {
      const { children } = item
      const currSelector = [...value_selector, item.variable]
      if (!children)
        return filterVar(item, currSelector)
      const obj = findExceptVarInObject(item, filterVar, currSelector, false) // File doesn't contains file children
      return obj.children && (obj.children as Var[])?.length > 0
    }),
  }
  return res
}

const formatItem = (
  item: any,
  isChatMode: boolean,
  filterVar: (payload: Var, selector: ValueSelector) => boolean,
): NodeOutPutVar => {
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
          variable: 'sys.dialogue_count',
          type: VarType.number,
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
      res.vars.push({
        variable: 'sys.app_id',
        type: VarType.string,
      })
      res.vars.push({
        variable: 'sys.workflow_id',
        type: VarType.string,
      })
      res.vars.push({
        variable: 'sys.workflow_run_id',
        type: VarType.string,
      })

      break
    }

    case BlockEnum.LLM: {
      res.vars = [...LLM_OUTPUT_STRUCT]
      if (data.structured_output_enabled && data.structured_output?.schema?.properties && Object.keys(data.structured_output.schema.properties).length > 0) {
        res.vars.push({
          variable: 'structured_output',
          type: VarType.object,
          children: data.structured_output,
        })
      }

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
      res.vars = outputs
        ? Object.keys(outputs).map((key) => {
          return {
            variable: key,
            type: outputs[key].type,
          }
        })
        : []
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

    // eslint-disable-next-line sonarjs/no-duplicated-branches
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
      const {
        output_schema,
      } = data as ToolNodeType
      if (!output_schema) {
        res.vars = TOOL_OUTPUT_STRUCT
      }
      else {
        const outputSchema: any[] = []
        Object.keys(output_schema.properties).forEach((outputKey) => {
          const output = output_schema.properties[outputKey]
          const dataType = output.type
          outputSchema.push({
            variable: outputKey,
            type: dataType === 'array'
              ? `array[${output.items?.type.slice(0, 1).toLocaleLowerCase()}${output.items?.type.slice(1)}]`
              : `${output.type.slice(0, 1).toLocaleLowerCase()}${output.type.slice(1)}`,
            description: output.description,
            children: output.type === 'object' ? {
              schema: {
                type: 'object',
                properties: output.properties,
              },
            } : undefined,
          })
        })
        res.vars = [
          ...TOOL_OUTPUT_STRUCT,
          ...outputSchema,
        ]
      }
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

    case BlockEnum.Loop: {
      const { loop_variables } = data as LoopNodeType
      res.isLoop = true
      res.vars = loop_variables?.map((v) => {
        return {
          variable: v.label,
          type: v.var_type,
          isLoopVariable: true,
          nodeId: res.nodeId,
        }
      }) || []

      break
    }

    case BlockEnum.DocExtractor: {
      res.vars = [
        {
          variable: 'text',
          type: (data as DocExtractorNodeType).is_array_file ? VarType.arrayString : VarType.string,
        },
      ]
      break
    }

    case BlockEnum.ListFilter: {
      if (!(data as ListFilterNodeType).var_type)
        break

      res.vars = [
        {
          variable: 'result',
          type: (data as ListFilterNodeType).var_type,
        },
        {
          variable: 'first_record',
          type: (data as ListFilterNodeType).item_var_type,
        },
        {
          variable: 'last_record',
          type: (data as ListFilterNodeType).item_var_type,
        },
      ]
      break
    }

    case BlockEnum.Agent: {
      const payload = data as AgentNodeType
      const outputs: Var[] = []
      Object.keys(payload.output_schema?.properties || {}).forEach((outputKey) => {
        const output = payload.output_schema.properties[outputKey]
        outputs.push({
          variable: outputKey,
          type: output.type === 'array'
            ? `Array[${output.items?.type.slice(0, 1).toLocaleUpperCase()}${output.items?.type.slice(1)}]` as VarType
            : `${output.type.slice(0, 1).toLocaleUpperCase()}${output.type.slice(1)}` as VarType,
        })
      })
      res.vars = [
        ...outputs,
        ...TOOL_OUTPUT_STRUCT,
      ]
      break
    }

    case 'env': {
      res.vars = data.envList.map((env: EnvironmentVariable) => {
        return {
          variable: `env.${env.name}`,
          type: env.value_type,
        }
      }) as Var[]
      break
    }

    case 'conversation': {
      res.vars = data.chatVarList.map((chatVar: ConversationVariable) => {
        return {
          variable: `conversation.${chatVar.name}`,
          type: chatVar.value_type,
          des: chatVar.description,
        }
      }) as Var[]
      break
    }
  }

  const { error_strategy } = data

  if (error_strategy) {
    res.vars = [
      ...res.vars,
      {
        variable: 'error_message',
        type: VarType.string,
        isException: true,
      },
      {
        variable: 'error_type',
        type: VarType.string,
        isException: true,
      },
    ]
  }

  const selector = [id]
  res.vars = res.vars.filter((v) => {
    const isCurrentMatched = filterVar(v, (() => {
      const variableArr = v.variable.split('.')
      const [first] = variableArr
      if (first === 'sys' || first === 'env' || first === 'conversation')
        return variableArr

      return [...selector, ...variableArr]
    })())
    if (isCurrentMatched)
      return true

    const isFile = v.type === VarType.file
    const children = (() => {
      if (isFile) {
        return OUTPUT_FILE_SUB_VARIABLES.map((key) => {
          return {
            variable: key,
            type: key === 'size' ? VarType.number : VarType.string,
          }
        })
      }
      return v.children
    })()
    if (!children)
      return false

    const obj = findExceptVarInObject(isFile ? { ...v, children } : v, filterVar, selector, isFile)
    return obj?.children && ((obj?.children as Var[]).length > 0 || Object.keys((obj?.children as StructuredOutput)?.schema?.properties || {}).length > 0)
  }).map((v) => {
    const isFile = v.type === VarType.file

    const { children } = (() => {
      if (isFile) {
        return {
          children: OUTPUT_FILE_SUB_VARIABLES.map((key) => {
            return {
              variable: key,
              type: key === 'size' ? VarType.number : VarType.string,
            }
          }),
        }
      }
      return v
    })()

    if (!children)
      return v

    return findExceptVarInObject(isFile ? { ...v, children } : v, filterVar, selector, isFile)
  })

  return res
}
export const toNodeOutputVars = (
  nodes: any[],
  isChatMode: boolean,
  filterVar = (_payload: Var, _selector: ValueSelector) => true,
  environmentVariables: EnvironmentVariable[] = [],
  conversationVariables: ConversationVariable[] = [],
): NodeOutPutVar[] => {
  // ENV_NODE data format
  const ENV_NODE = {
    id: 'env',
    data: {
      title: 'ENVIRONMENT',
      type: 'env',
      envList: environmentVariables,
    },
  }
  // CHAT_VAR_NODE data format
  const CHAT_VAR_NODE = {
    id: 'conversation',
    data: {
      title: 'CONVERSATION',
      type: 'conversation',
      chatVarList: conversationVariables,
    },
  }
  const res = [
    ...nodes.filter(node => SUPPORT_OUTPUT_VARS_NODE.includes(node?.data?.type)),
    ...(environmentVariables.length > 0 ? [ENV_NODE] : []),
    ...((isChatMode && conversationVariables.length > 0) ? [CHAT_VAR_NODE] : []),
  ].map((node) => {
    return {
      ...formatItem(node, isChatMode, filterVar),
      isStartNode: node.data.type === BlockEnum.Start,
    }
  }).filter(item => item.vars.length > 0)
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
  const isSystem = isSystemVar(valueSelector)

  const targetVar = isSystem ? beforeNodesOutputVars.find(v => v.isStartNode) : beforeNodesOutputVars.find(v => v.nodeId === outputVarNodeId)
  if (!targetVar)
    return VarType.string

  let arrayType: VarType = VarType.string

  let curr: any = targetVar.vars
  if (isSystem) {
    arrayType = curr.find((v: any) => v.variable === (valueSelector).join('.'))?.type
  }
  else {
    (valueSelector).slice(1).forEach((key, i) => {
      const isLast = i === valueSelector.length - 2
      curr = curr?.find((v: any) => v.variable === key)
      if (isLast) {
        arrayType = curr?.type
      }
      else {
        if (curr?.type === VarType.object || curr?.type === VarType.file)
          curr = curr.children
      }
    })
  }

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
      return VarType.file
    default:
      return VarType.string
  }
}

const getLoopItemType = ({
  valueSelector,
  beforeNodesOutputVars,
}: {
  valueSelector: ValueSelector
  beforeNodesOutputVars: NodeOutPutVar[]
  // eslint-disable-next-line sonarjs/no-identical-functions
}): VarType => {
  const outputVarNodeId = valueSelector[0]
  const isSystem = isSystemVar(valueSelector)

  const targetVar = isSystem ? beforeNodesOutputVars.find(v => v.isStartNode) : beforeNodesOutputVars.find(v => v.nodeId === outputVarNodeId)
  if (!targetVar)
    return VarType.string

  let arrayType: VarType = VarType.string

  let curr: any = targetVar.vars
  if (isSystem) {
    arrayType = curr.find((v: any) => v.variable === (valueSelector).join('.'))?.type
  }
  else {
    (valueSelector).slice(1).forEach((key, i) => {
      const isLast = i === valueSelector.length - 2
      curr = curr?.find((v: any) => v.variable === key)
      if (isLast) {
        arrayType = curr?.type
      }
      else {
        if (curr?.type === VarType.object || curr?.type === VarType.file)
          curr = curr.children
      }
    })
  }

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
      return VarType.file
    default:
      return VarType.string
  }
}

export const getVarType = ({
  parentNode,
  valueSelector,
  isIterationItem,
  isLoopItem,
  availableNodes,
  isChatMode,
  isConstant,
  environmentVariables = [],
  conversationVariables = [],
}: {
  valueSelector: ValueSelector
  parentNode?: Node | null
  isIterationItem?: boolean
  isLoopItem?: boolean
  availableNodes: any[]
  isChatMode: boolean
  isConstant?: boolean
  environmentVariables?: EnvironmentVariable[]
  conversationVariables?: ConversationVariable[]
}): VarType => {
  if (isConstant)
    return VarType.string

  const beforeNodesOutputVars = toNodeOutputVars(
    availableNodes,
    isChatMode,
    undefined,
    environmentVariables,
    conversationVariables,
  )

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
  }

  const isLoopInnerVar = parentNode?.data.type === BlockEnum.Loop
  if (isLoopItem) {
    return getLoopItemType({
      valueSelector,
      beforeNodesOutputVars,
    })
  }
  if (isLoopInnerVar) {
    if (valueSelector[1] === 'item') {
      const itemType = getLoopItemType({
        valueSelector: (parentNode?.data as any).iterator_selector || [],
        beforeNodesOutputVars,
      })
      return itemType
    }
    if (valueSelector[1] === 'index')
      return VarType.number
  }

  const isSystem = isSystemVar(valueSelector)
  const isEnv = isENV(valueSelector)
  const isChatVar = isConversationVar(valueSelector)
  const startNode = availableNodes.find((node: any) => {
    return node?.data.type === BlockEnum.Start
  })

  const targetVarNodeId = isSystem ? startNode?.id : valueSelector[0]
  const targetVar = beforeNodesOutputVars.find(v => v.nodeId === targetVarNodeId)

  if (!targetVar)
    return VarType.string

  let type: VarType = VarType.string
  let curr: any = targetVar.vars

  if (isSystem || isEnv || isChatVar) {
    return curr.find((v: any) => v.variable === (valueSelector as ValueSelector).join('.'))?.type
  }
  else {
    const targetVar = curr.find((v: any) => v.variable === valueSelector[1])
    if (!targetVar)
      return VarType.string

    const isStructuredOutputVar = !!targetVar.children?.schema?.properties
    if (isStructuredOutputVar) {
      if (valueSelector.length === 2) { // root
        return VarType.object
      }
      let currProperties = targetVar.children.schema;
      (valueSelector as ValueSelector).slice(2).forEach((key, i) => {
        const isLast = i === valueSelector.length - 3
        if (!currProperties)
          return

        currProperties = currProperties.properties[key]
        if (isLast)
          type = structTypeToVarType(currProperties?.type)
      })
      return type
    }

    (valueSelector as ValueSelector).slice(1).forEach((key, i) => {
      const isLast = i === valueSelector.length - 2
      if (Array.isArray(curr))
        curr = curr?.find((v: any) => v.variable === key)

      if (isLast) {
        type = curr?.type
      }
      else {
        if (curr?.type === VarType.object || curr?.type === VarType.file)
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
  environmentVariables,
  conversationVariables,
  filterVar,
}: {
  parentNode?: Node | null
  t?: any
  // to get those nodes output vars
  beforeNodes: Node[]
  isChatMode: boolean
  // env
  environmentVariables?: EnvironmentVariable[]
  // chat var
  conversationVariables?: ConversationVariable[]
  filterVar: (payload: Var, selector: ValueSelector) => boolean
}): NodeOutPutVar[] => {
  const beforeNodesOutputVars = toNodeOutputVars(
    beforeNodes,
    isChatMode,
    filterVar,
    environmentVariables,
    conversationVariables,
  )
  const isInIteration = parentNode?.data.type === BlockEnum.Iteration
  if (isInIteration) {
    const iterationNode: any = parentNode
    const itemType = getVarType({
      parentNode: iterationNode,
      isIterationItem: true,
      valueSelector: iterationNode?.data.iterator_selector || [],
      availableNodes: beforeNodes,
      isChatMode,
      environmentVariables,
      conversationVariables,
    })
    const itemChildren = itemType === VarType.file
      ? {
        children: OUTPUT_FILE_SUB_VARIABLES.map((key) => {
          return {
            variable: key,
            type: key === 'size' ? VarType.number : VarType.string,
          }
        }),
      }
      : {}
    const iterationVar = {
      nodeId: iterationNode?.id,
      title: t('workflow.nodes.iteration.currentIteration'),
      vars: [
        {
          variable: 'item',
          type: itemType,
          ...itemChildren,
        },
        {
          variable: 'index',
          type: VarType.number,
        },
      ],
    }
    const iterationIndex = beforeNodesOutputVars.findIndex(v => v.nodeId === iterationNode?.id)
    if (iterationIndex > -1)
      beforeNodesOutputVars.splice(iterationIndex, 1)
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
      const payload = data as LLMNodeType
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
        return c.variable_selector || []
      }) || []
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
      const payload = data as QuestionClassifierNodeType
      res = [payload.query_variable_selector]
      const varInInstructions = matchNotSystemVars([payload.instruction || ''])
      res.push(...varInInstructions)
      break
    }
    case BlockEnum.HttpRequest: {
      const payload = data as HttpNodeType
      res = matchNotSystemVars([payload.url, payload.headers, payload.params, typeof payload.body.data === 'string' ? payload.body.data : payload.body.data.map(d => d.value).join('')])
      break
    }
    case BlockEnum.Tool: {
      const payload = data as ToolNodeType
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
      const payload = data as ParameterExtractorNodeType
      res = [payload.query]
      const varInInstructions = matchNotSystemVars([payload.instruction || ''])
      res.push(...varInInstructions)
      break
    }

    case BlockEnum.Iteration: {
      res = [(data as IterationNodeType).iterator_selector]
      break
    }

    case BlockEnum.Loop: {
      const payload = data as LoopNodeType
      res = payload.break_conditions?.map((c) => {
        return c.variable_selector || []
      }) || []
      break
    }

    case BlockEnum.ListFilter: {
      res = [(data as ListFilterNodeType).variable]
      break
    }

    case BlockEnum.Agent: {
      const payload = data as AgentNodeType
      const valueSelectors: ValueSelector[] = []
      if (!payload.agent_parameters)
        break

      Object.keys(payload.agent_parameters || {}).forEach((key) => {
        const { value } = payload.agent_parameters![key]
        if (typeof value === 'string')
          valueSelectors.push(...matchNotSystemVars([value]))
      })
      res = valueSelectors
      break
    }
  }
  return res || []
}

// can be used in iteration node
export const getNodeUsedVarPassToServerKey = (node: Node, valueSelector: ValueSelector): string | string[] => {
  const { data } = node
  const { type } = data
  let res: string | string[] = ''
  switch (type) {
    case BlockEnum.LLM: {
      const payload = data as LLMNodeType
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
      const targetVar = (data as IfElseNodeType).conditions?.find(c => c.variable_selector?.join('.') === valueSelector.join('.'))
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
            if (c.variable_selector?.join('.') === oldVarSelector.join('.'))
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
        if (typeof payload.body.data === 'string') {
          payload.body.data = replaceOldVarInText(payload.body.data, oldVarSelector, newVarSelector)
        }
        else {
          payload.body.data = payload.body.data.map((d) => {
            return {
              ...d,
              value: replaceOldVarInText(d.value || '', oldVarSelector, newVarSelector),
            }
          })
        }
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
      // eslint-disable-next-line sonarjs/no-duplicated-branches
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
      case BlockEnum.Loop: {
        const payload = data as LoopNodeType
        if (payload.break_conditions) {
          payload.break_conditions = payload.break_conditions.map((c) => {
            if (c.variable_selector?.join('.') === oldVarSelector.join('.'))
              c.variable_selector = newVarSelector
            return c
          })
        }
        break
      }
      case BlockEnum.ListFilter: {
        const payload = data as ListFilterNodeType
        if (payload.variable.join('.') === oldVarSelector.join('.'))
          payload.variable = newVarSelector
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
  const isStructuredOutput = !!(v.children as StructuredOutput)?.schema?.properties

  if ((v.children as Var[])?.length > 0) {
    (v.children as Var[]).forEach((child) => {
      varToValueSelectorList(child, [...parentValueSelector, v.variable], res)
    })
  }
  if (isStructuredOutput) {
    Object.keys((v.children as StructuredOutput)?.schema?.properties || {}).forEach((key) => {
      const type = (v.children as StructuredOutput)?.schema?.properties[key].type
      const isArray = type === Type.array
      const arrayType = (v.children as StructuredOutput)?.schema?.properties[key].items?.type
      varToValueSelectorList({
        variable: key,
        type: structTypeToVarType(isArray ? arrayType! : type, isArray),
      }, [...parentValueSelector, v.variable], res)
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
      const vars = [...LLM_OUTPUT_STRUCT]
      const llmNodeData = data as LLMNodeType
      if (llmNodeData.structured_output_enabled && llmNodeData.structured_output?.schema?.properties && Object.keys(llmNodeData.structured_output.schema.properties).length > 0) {
        vars.push({
          variable: 'structured_output',
          type: VarType.object,
          children: llmNodeData.structured_output,
        })
      }
      varsToValueSelectorList(vars, [id], res)
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

    case BlockEnum.Loop: {
      res.push([id, 'output'])
      break
    }

    case BlockEnum.DocExtractor: {
      res.push([id, 'text'])
      break
    }

    case BlockEnum.ListFilter: {
      res.push([id, 'result'])
      res.push([id, 'first_record'])
      res.push([id, 'last_record'])
      break
    }
  }

  return res
}
