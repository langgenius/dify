import type { PluginTriggerNodeType } from '@/app/components/workflow/nodes/trigger-plugin/types'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { produce } from 'immer'
import { BlockEnum } from '@/app/components/workflow/types'

export type TriggerPluginNodePayload = {
  title: string
  desc: string
  plugin_id: string
  provider_id: string
  event_name: string
  subscription_id: string
  plugin_unique_identifier: string
  event_parameters: Record<string, unknown>
}

export type WorkflowDraftSyncParams = Pick<
  FetchWorkflowDraftResponse,
  'graph' | 'features' | 'environment_variables' | 'conversation_variables'
>

const removeTempProperties = (data: Record<string, unknown>): void => {
  Object.keys(data).forEach((key) => {
    if (key.startsWith('_'))
      delete data[key]
  })
}

type TriggerParameterSchema = Record<string, unknown>

type TriggerPluginHydratePayload = (PluginTriggerNodeType & {
  paramSchemas?: TriggerParameterSchema[]
  parameters_schema?: TriggerParameterSchema[]
})

const sanitizeTriggerPluginNode = (node: Node<TriggerPluginNodePayload>): Node<TriggerPluginNodePayload> => {
  const data = node.data

  if (!data || data.type !== BlockEnum.TriggerPlugin)
    return node

  const sanitizedData: TriggerPluginNodePayload & { type: BlockEnum.TriggerPlugin } = {
    type: BlockEnum.TriggerPlugin,
    title: data.title ?? '',
    desc: data.desc ?? '',
    plugin_id: data.plugin_id ?? '',
    provider_id: data.provider_id ?? '',
    event_name: data.event_name ?? '',
    subscription_id: data.subscription_id ?? '',
    plugin_unique_identifier: data.plugin_unique_identifier ?? '',
    event_parameters: (typeof data.event_parameters === 'object' && data.event_parameters !== null)
      ? data.event_parameters as Record<string, unknown>
      : {},
  }

  return {
    ...node,
    data: sanitizedData,
  }
}

export const sanitizeWorkflowDraftPayload = (params: WorkflowDraftSyncParams): WorkflowDraftSyncParams => {
  const { graph } = params

  if (!graph?.nodes?.length)
    return params

  const sanitizedNodes = graph.nodes.map((node) => {
    // First sanitize known node types (TriggerPlugin)
    const n = sanitizeTriggerPluginNode(node as Node<TriggerPluginNodePayload>) as Node<any>

    // Normalize Start node variable json_schema: ensure dict, not string
    if ((n.data as any)?.type === BlockEnum.Start && Array.isArray((n.data as any).variables)) {
      const next = { ...n, data: { ...n.data } }
      next.data.variables = (n.data as any).variables.map((v: any) => {
        if (v && v.type === 'json_object' && typeof v.json_schema === 'string') {
          try {
            const obj = JSON.parse(v.json_schema)
            return { ...v, json_schema: obj }
          }
          catch {
            return v
          }
        }
        return v
      })
      return next
    }

    return n
  })

  return {
    ...params,
    graph: {
      ...graph,
      nodes: sanitizedNodes,
    },
  }
}

const isTriggerPluginNode = (node: Node): node is Node<TriggerPluginHydratePayload> => {
  const data = node.data as unknown

  if (!data || typeof data !== 'object')
    return false

  const payload = data as Partial<TriggerPluginHydratePayload> & { type?: BlockEnum }

  if (payload.type !== BlockEnum.TriggerPlugin)
    return false

  return 'event_parameters' in payload
}

const hydrateTriggerPluginNode = (node: Node): Node => {
  if (!isTriggerPluginNode(node))
    return node

  const typedNode = node as Node<TriggerPluginHydratePayload>
  const data = typedNode.data
  const eventParameters = data.event_parameters ?? {}
  const parametersSchema = data.parameters_schema ?? data.paramSchemas ?? []
  const config = data.config ?? eventParameters ?? {}

  const nextData: typeof data = {
    ...data,
    config,
    paramSchemas: data.paramSchemas ?? parametersSchema,
    parameters_schema: parametersSchema,
  }

  return {
    ...typedNode,
    data: nextData,
  }
}

export const hydrateWorkflowDraftResponse = (draft: FetchWorkflowDraftResponse): FetchWorkflowDraftResponse => {
  return produce(draft, (mutableDraft) => {
    if (!mutableDraft?.graph)
      return

    if (mutableDraft.graph.nodes) {
      mutableDraft.graph.nodes = mutableDraft.graph.nodes
        .filter((node: Node) => !node.data?._isTempNode)
        .map((node: Node) => {
          if (node.data)
            removeTempProperties(node.data as Record<string, unknown>)

          let n = hydrateTriggerPluginNode(node)
          // Normalize Start node variable json_schema to object when loading
          if ((n.data as any)?.type === BlockEnum.Start && Array.isArray((n.data as any).variables)) {
            const next = { ...n, data: { ...n.data } } as Node<any>
            next.data.variables = (n.data as any).variables.map((v: any) => {
              if (v && v.type === 'json_object' && typeof v.json_schema === 'string') {
                try {
                  const obj = JSON.parse(v.json_schema)
                  return { ...v, json_schema: obj }
                }
                catch {
                  return v
                }
              }
              return v
            })
            n = next
          }
          return n
        })
    }

    if (mutableDraft.graph.edges) {
      mutableDraft.graph.edges = mutableDraft.graph.edges
        .filter((edge: Edge) => !edge.data?._isTemp)
        .map((edge: Edge) => {
          if (edge.data)
            removeTempProperties(edge.data as Record<string, unknown>)

          return edge
        })
    }

    if (mutableDraft.environment_variables) {
      mutableDraft.environment_variables = mutableDraft.environment_variables.map(env =>
        env.value_type === 'secret'
          ? { ...env, value: '[__HIDDEN__]' }
          : env,
      )
    }
  })
}
