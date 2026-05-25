import type { InputVarType, Node, NodeOutPutVar } from '@/app/components/workflow/types'
import type { SnippetInputField } from '@/models/snippet'
import { NODE_WIDTH } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { inputVarTypeToVarType } from '../../data-source/utils'

export const SNIPPET_INPUT_FIELD_NODE_ID = 'start'

export const isSnippetCanvas = () => {
  if (typeof globalThis.location === 'undefined')
    return false

  return /^\/snippets\/[^/]+\/orchestrate/.test(globalThis.location.pathname)
}

const toWorkflowInputType = (type: SnippetInputField['type']) => type as unknown as InputVarType

export const buildSnippetInputFieldNode = (
  fields: SnippetInputField[],
  title: string,
): Node | undefined => {
  const variables = fields.filter(field => !!field.variable)

  if (!variables.length)
    return undefined

  return {
    id: SNIPPET_INPUT_FIELD_NODE_ID,
    type: 'custom',
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: 80,
    data: {
      title,
      desc: '',
      type: BlockEnum.Start,
      variables: variables.map(field => ({
        type: toWorkflowInputType(field.type),
        label: field.label,
        variable: field.variable,
        max_length: field.max_length,
        default: field.default_value,
        required: field.required,
        options: field.options,
        placeholder: field.placeholder,
        unit: field.unit,
        allowed_file_upload_methods: field.allowed_file_upload_methods,
        allowed_file_types: field.allowed_file_types,
        allowed_file_extensions: field.allowed_file_extensions,
      })),
    },
  } as Node
}

export const buildSnippetInputFieldVars = (
  fields: SnippetInputField[],
  title: string,
): NodeOutPutVar | undefined => {
  const vars = fields
    .filter(field => !!field.variable)
    .map(field => ({
      variable: field.variable,
      type: inputVarTypeToVarType(field.type as PipelineInputVarType),
      isParagraph: field.type === PipelineInputVarType.paragraph,
      isSelect: field.type === PipelineInputVarType.select,
      options: field.options,
      required: field.required,
      des: field.label,
    }))

  if (!vars.length)
    return undefined

  return {
    nodeId: SNIPPET_INPUT_FIELD_NODE_ID,
    title,
    vars,
    isStartNode: true,
  }
}

export const appendSnippetInputFieldVars = ({
  availableNodes,
  fields,
  title,
}: {
  availableNodes: Node[]
  fields: SnippetInputField[]
  title: string
}) => {
  const shouldAppendSnippetInputFields = isSnippetCanvas()
    && fields.length > 0
    && !availableNodes.some(node => node.data.type === BlockEnum.Start)
  const snippetInputFieldNode = shouldAppendSnippetInputFields
    ? buildSnippetInputFieldNode(fields, title)
    : undefined
  const snippetInputFieldVars = shouldAppendSnippetInputFields
    ? buildSnippetInputFieldVars(fields, title)
    : undefined

  return {
    availableNodes: snippetInputFieldNode
      ? [snippetInputFieldNode, ...availableNodes]
      : availableNodes,
    availableVars: snippetInputFieldVars ? [snippetInputFieldVars] : [],
  }
}
