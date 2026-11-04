import { isEqual, isPlainObject } from 'es-toolkit/predicate'
import { BlockEnum, isTriggerNode } from '@/app/components/workflow/types'

export type DifyBuilderCanvasNode = {
  id?: string
  parentId?: string
  data?: {
    type?: BlockEnum
    [key: string]: unknown
  }
}

export type DifyBuilderCanvasSnapshot = {
  nodes: DifyBuilderCanvasNode[]
  edges: {
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }[]
  isChatflow: boolean
}

// Keep the same initial-template contract as services/dify_builder/initial_draft.py.
const initialData = (data: NonNullable<DifyBuilderCanvasNode['data']>) =>
  Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) =>
        value !== undefined &&
        !key.startsWith('_') &&
        key !== 'title' &&
        key !== 'selected' &&
        !(key === 'desc' && !value),
    ),
  )

export const isInitialChatflow = ({ nodes, edges, isChatflow }: DifyBuilderCanvasSnapshot) => {
  if (
    !isChatflow ||
    nodes.length !== 3 ||
    edges.length !== 2 ||
    nodes.some((node) => node.parentId)
  )
    return false
  const start = nodes.find((node) => node.data?.type === BlockEnum.Start)
  const llm = nodes.find((node) => node.data?.type === BlockEnum.LLM)
  const answer = nodes.find((node) => node.data?.type === BlockEnum.Answer)
  if (!start?.id || !llm?.id || !answer?.id || !start.data || !llm.data || !answer.data)
    return false
  if (
    ![
      [start.id, llm.id],
      [llm.id, answer.id],
    ].every(([source, target]) =>
      edges.some(
        (edge) =>
          edge.source === source &&
          edge.target === target &&
          (!edge.sourceHandle || edge.sourceHandle === 'source') &&
          (!edge.targetHandle || edge.targetHandle === 'target'),
      ),
    )
  )
    return false

  const llmData = initialData(llm.data)
  const model = llmData.model
  const memory = llmData.memory
  if (!isPlainObject(model) || !isPlainObject(memory)) return false
  // Opening the LLM panel can fill the workspace model and empty role prefixes.
  llmData.model = Object.fromEntries(
    Object.entries(model).filter(([key]) => key !== 'provider' && key !== 'name'),
  )
  llmData.memory = Object.fromEntries(
    Object.entries(memory).filter(
      ([key, value]) => key !== 'role_prefix' || !isEqual(value, { user: '', assistant: '' }),
    ),
  )
  return (
    isEqual(initialData(start.data), { type: BlockEnum.Start, variables: [] }) &&
    isEqual(initialData(answer.data), {
      type: BlockEnum.Answer,
      variables: [],
      answer: `{{#${llm.id}.text#}}`,
    }) &&
    isEqual(llmData, {
      type: BlockEnum.LLM,
      model: { mode: 'chat', completion_params: { temperature: 0.7 } },
      prompt_template: [{ role: 'system', text: '' }],
      context: { enabled: false, variable_selector: [] },
      vision: { enabled: false },
      memory: {
        window: { enabled: false, size: 10 },
        query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
      },
    })
  )
}

export const shouldStartBuildSession = (snapshot: DifyBuilderCanvasSnapshot) => {
  if (isInitialChatflow(snapshot)) return true
  const { nodes, edges } = snapshot
  if (edges.length > 0) return false

  return nodes.every((node) => {
    const type = node.data?.type
    return (
      !type ||
      type === BlockEnum.Start ||
      type === BlockEnum.StartPlaceholder ||
      isTriggerNode(type)
    )
  })
}
