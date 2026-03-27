import type { AgentSubGraphProps, AssembleSubGraphProps, SubGraphProps } from './types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Node, PromptItem, PromptTemplateItem } from '@/app/components/workflow/types'
import { NODE_WIDTH_X_OFFSET, START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { CUSTOM_SUB_GRAPH_START_NODE } from '@/app/components/workflow/nodes/sub-graph-start/constants'
import { BlockEnum, EditionType, isPromptMessageContext, PromptRole } from '@/app/components/workflow/types'

const SUB_GRAPH_EDGE_GAP = 160

export const defaultViewport = {
  x: SUB_GRAPH_EDGE_GAP,
  y: 50,
  zoom: 1,
} as const

export const SUB_GRAPH_ENTRY_POSITION = {
  x: START_INITIAL_POSITION.x,
  y: 150,
} as const

export const SUB_GRAPH_EXTRACTOR_POSITION = {
  x: SUB_GRAPH_ENTRY_POSITION.x + NODE_WIDTH_X_OFFSET - SUB_GRAPH_EDGE_GAP,
  y: SUB_GRAPH_ENTRY_POSITION.y,
} as const

export const getSubGraphSourceTitle = (props: SubGraphProps) => (
  props.variant === 'agent' ? (props.agentName || '') : (props.title || '')
)

export const getSubGraphExtractorNodeId = (props: SubGraphProps) => (
  `${props.toolNodeId}_ext_${props.paramKey}`
)

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const getSubGraphPromptText = (props: SubGraphProps) => {
  if (props.variant !== 'agent' || !props.toolParamValue)
    return ''

  const leadingPattern = new RegExp(`^\\{\\{[@#]${escapeRegExp(props.agentNodeId)}\\.context[@#]\\}\\}`)
  return props.toolParamValue.replace(leadingPattern, '')
}

export const buildSubGraphStartNode = (props: SubGraphProps, sourceTitle: string) => ({
  id: 'subgraph-source',
  type: CUSTOM_SUB_GRAPH_START_NODE,
  position: SUB_GRAPH_ENTRY_POSITION,
  data: {
    type: BlockEnum.Start,
    title: sourceTitle,
    desc: '',
    selected: false,
    iconType: props.variant === 'agent' ? 'agent' : 'assemble',
    variables: [],
  },
  selected: false,
  selectable: false,
  draggable: false,
  connectable: false,
  focusable: false,
  deletable: false,
})

const applyPromptText = (item: PromptItem, promptText: string): PromptItem => {
  if (item.edition_type === EditionType.jinja2) {
    return {
      ...item,
      text: promptText,
      jinja2_text: promptText,
    }
  }

  return { ...item, text: promptText }
}

const buildExtractorPromptTemplate = (template: PromptTemplateItem | PromptTemplateItem[], promptText: string) => {
  if (!Array.isArray(template))
    return applyPromptText(template as PromptItem, promptText)

  const userIndex = template.findIndex(
    item => !isPromptMessageContext(item) && (item as PromptItem).role === PromptRole.user,
  )

  if (userIndex >= 0) {
    return template.map((item, index) => {
      if (index !== userIndex)
        return item
      return applyPromptText(item as PromptItem, promptText)
    }) as PromptTemplateItem[]
  }

  const useJinja = template.some(
    item => !isPromptMessageContext(item) && (item as PromptItem).edition_type === EditionType.jinja2,
  )
  const defaultUserPrompt: PromptItem = useJinja
    ? {
        role: PromptRole.user,
        text: promptText,
        jinja2_text: promptText,
        edition_type: EditionType.jinja2,
      }
    : { role: PromptRole.user, text: promptText }

  return [...template, defaultUserPrompt] as PromptTemplateItem[]
}

export function buildSubGraphExtractorDisplayNode(props: AgentSubGraphProps, promptText: string): Node<LLMNodeType> | null
export function buildSubGraphExtractorDisplayNode(props: AssembleSubGraphProps, promptText: string): Node<CodeNodeType> | null
export function buildSubGraphExtractorDisplayNode(props: SubGraphProps, promptText: string): Node<LLMNodeType> | Node<CodeNodeType> | null
export function buildSubGraphExtractorDisplayNode(props: SubGraphProps, promptText: string): Node<LLMNodeType> | Node<CodeNodeType> | null {
  const extractorNode = props.extractorNode
  if (!extractorNode)
    return null

  if (props.variant !== 'agent') {
    const assembleExtractorNode = extractorNode as Node<CodeNodeType>
    return {
      ...assembleExtractorNode,
      hidden: false,
      selected: false,
      position: SUB_GRAPH_EXTRACTOR_POSITION,
      data: {
        ...assembleExtractorNode.data,
        selected: false,
      },
    }
  }

  const agentExtractorNode = extractorNode as Node<LLMNodeType>
  return {
    ...agentExtractorNode,
    hidden: false,
    selected: false,
    position: SUB_GRAPH_EXTRACTOR_POSITION,
    data: {
      ...agentExtractorNode.data,
      selected: false,
      prompt_template: buildExtractorPromptTemplate(agentExtractorNode.data.prompt_template, promptText),
    },
  }
}

export const buildSubGraphEdges = (
  props: SubGraphProps,
  startNode: ReturnType<typeof buildSubGraphStartNode>,
  extractorDisplayNode: Node<LLMNodeType> | Node<CodeNodeType> | null,
) => {
  if (!extractorDisplayNode)
    return []

  return [
    {
      id: `${startNode.id}-${extractorDisplayNode.id}`,
      source: startNode.id,
      sourceHandle: 'source',
      target: extractorDisplayNode.id,
      targetHandle: 'target',
      type: 'custom',
      selectable: false,
      data: {
        sourceType: BlockEnum.Start,
        targetType: props.variant === 'agent' ? BlockEnum.LLM : BlockEnum.Code,
        _isTemp: true,
        _isSubGraphTemp: true,
      },
    },
  ]
}
