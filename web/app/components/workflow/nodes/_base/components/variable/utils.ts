import type { CodeNodeType } from '../../../code/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import type { VariableAssignerNodeType } from '@/app/components/workflow/nodes/variable-assigner/types'
import {
  CHAT_QUESTION_CLASSIFIER_OUTPUT_STRUCT,
  COMPLETION_QUESTION_CLASSIFIER_OUTPUT_STRUCT,
  HTTP_REQUEST_OUTPUT_STRUCT,
  KNOWLEDGE_RETRIEVAL_OUTPUT_STRUCT,
  LLM_OUTPUT_STRUCT,
  SUPPORT_OUTPUT_VARS_NODE,
  TEMPLATE_TRANSFORM_OUTPUT_STRUCT,
  TOOL_OUTPUT_STRUCT,
} from '@/app/components/workflow/constants'

const inputVarTypeToVarType = (type: InputVarType): VarType => {
  if (type === InputVarType.number)
    return VarType.number

  return VarType.string
}

const findExceptVarInObject = (obj: any, filterVar: (payload: Var) => boolean): Var => {
  const { children } = obj
  const res: Var = {
    variable: obj.variable,
    type: VarType.object,
    children: children.filter((item: Var) => {
      const { children } = item
      if (!children)
        return filterVar(item)

      const obj = findExceptVarInObject(item, filterVar)
      return obj.children && obj.children?.length > 0
    }),
  }
  return res
}

const formatItem = (item: any, isChatMode: boolean, filterVar: (payload: any) => boolean): NodeOutPutVar => {
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
        }
      })
      if (isChatMode) {
        res.vars.push({
          variable: 'sys.query',
          type: VarType.string,
        })

        res.vars.push({
          variable: 'sys.files',
          type: VarType.arrayFile,
        })
      }
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
      res.vars = isChatMode ? CHAT_QUESTION_CLASSIFIER_OUTPUT_STRUCT : COMPLETION_QUESTION_CLASSIFIER_OUTPUT_STRUCT
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

  res.vars = res.vars.filter((v) => {
    const { children } = v
    if (!children)
      return filterVar(v)

    const obj = findExceptVarInObject(v, filterVar)
    return obj?.children && obj?.children.length > 0
  }).map((v) => {
    const { children } = v
    if (!children)
      return v

    return findExceptVarInObject(v, filterVar)
  })

  return res
}
export const toNodeOutputVars = (nodes: any[], isChatMode: boolean, filterVar = (_payload: Var) => true): NodeOutPutVar[] => {
  const res = nodes
    .filter(node => SUPPORT_OUTPUT_VARS_NODE.includes(node.data.type))
    .map(node => formatItem(node, isChatMode, filterVar))
    .filter(item => item.vars.length > 0)
  return res
}
