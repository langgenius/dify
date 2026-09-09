import type { HumanInputNodeType } from '../../human-input/types'
import type { HumanInputV2NodeType } from '../types'
import type {
  HumanInputMigrationApi,
  HumanInputMigrationBlocker,
  HumanInputMigrationGraph,
  HumanInputMigrationPlan,
} from './types'
import {
  zNodeDataMigrationFailureResponse,
  zNodeDataMigrationResponse,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { ORPCError } from '@orpc/client'
import { isEqual } from 'es-toolkit'
import { cloneDeep } from 'es-toolkit/object'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { consoleClient } from '@/service/client'
import { isHumanInputV2NodeData } from '../types'
import { classifyHumanInputVersion, HumanInputVersionKind } from './policy'
import { HumanInputMigrationBlockerCode } from './types'

/** The backend owns legacy alias handling and recipient conversion. */
export const createHumanInputMigrationApi = (
  client: typeof consoleClient.workspaces.current.humanInput.nodeDataMigration = consoleClient
    .workspaces.current.humanInput.nodeDataMigration,
): HumanInputMigrationApi => ({
  async migrate(request) {
    try {
      // The HTTP compatibility DTO accepts raw historical delivery JSON, while its
      // generated schema documents canonical methods only. Preserve aliases and
      // unsupported methods here so backend preflight can report precise blockers.
      const body = request as Parameters<typeof client.post>[0]['body']
      const response = zNodeDataMigrationResponse.parse(
        await client.post({ body }, { context: { silent: true } }),
      )
      return {
        status: 'success',
        data: response.data.map(({ node_id, node_data }) => {
          if (node_data.version !== '2') throw new Error('human-input-migration-invalid-response')
          // Legacy forms migrate to paragraph inputs. Normalize nullable defaults
          // for the existing editor, without converting recipients a second time.
          const inputs = (node_data.inputs ?? []).map((input) => {
            if (input.type !== 'paragraph')
              throw new Error('human-input-migration-invalid-response')
            return {
              ...input,
              type: InputVarType.paragraph,
              default: {
                type: input.default?.type ?? 'constant',
                selector: input.default?.selector ?? [],
                value: input.default?.value ?? '',
              },
            }
          })
          // The editor uses TS enums for common node fields whose generated DTO
          // counterparts are string literals. All remote fields were validated above.
          const data = {
            ...node_data,
            type: BlockEnum.HumanInput,
            version: '2',
            desc: node_data.desc ?? '',
            error_strategy: node_data.error_strategy ?? undefined,
            default_value: node_data.default_value ?? undefined,
            inputs,
            user_actions: node_data.user_actions ?? [],
          } as HumanInputV2NodeType
          return { node_id, node_data: data }
        }),
      }
    } catch (error) {
      const status =
        error instanceof Response || error instanceof ORPCError ? error.status : undefined
      if (status !== 400) throw error
      const data: unknown =
        error instanceof Response
          ? await error
              .clone()
              .json()
              .catch(() => undefined)
          : error instanceof ORPCError
            ? error.data
            : undefined
      const body = data && typeof data === 'object' && 'body' in data ? data.body : data
      const failure = zNodeDataMigrationFailureResponse.safeParse(body)
      if (!failure.success || !failure.data.blockers.length) throw error
      return {
        status: 'blocked',
        blockers: failure.data.blockers.map((blocker) => ({
          code: blocker.code,
          nodeId: blocker.node_id,
          nodeTitle: blocker.node_title,
          methodId: blocker.method_id ?? undefined,
          value: blocker.value ?? undefined,
        })),
      }
    }
  },
})

export type HumanInputMigrationExecutionResult =
  | { status: 'success'; migratedNodeIds: string[] }
  | { status: 'noop' }
  | { status: 'graph-changed' }
  | { status: 'blocked'; blockers: HumanInputMigrationBlocker[] }
  | { status: 'sync-error'; error: unknown }

export type HumanInputMigrationExecutorDependencies = {
  getGraph: () => HumanInputMigrationGraph
  canApply?: () => boolean
  migrationApi: HumanInputMigrationApi
  replaceGraph: (graph: HumanInputMigrationGraph, source: string) => void
  syncDraft: () => Promise<void>
  saveHistory: (migratedNodeIds: string[]) => void
}

export const executeHumanInputV2Migration = async ({
  getGraph,
  canApply = () => true,
  migrationApi,
  replaceGraph,
  syncDraft,
  saveHistory,
}: HumanInputMigrationExecutorDependencies): Promise<HumanInputMigrationExecutionResult> => {
  if (!canApply()) return { status: 'graph-changed' }
  const originalGraph = cloneDeep(getGraph())
  const blockers: HumanInputMigrationBlocker[] = []
  const nodes = originalGraph.nodes.flatMap((node) => {
    const kind = classifyHumanInputVersion(node.data)
    if (kind === HumanInputVersionKind.V2 || kind === HumanInputVersionKind.NotHumanInput) return []
    if (kind === HumanInputVersionKind.LegacyBlocked) {
      blockers.push({
        nodeId: node.id,
        nodeTitle: node.data.title,
        code: HumanInputMigrationBlockerCode.UnsupportedVersion,
        value: String((node.data as { version?: unknown }).version),
      })
      return []
    }
    return [{ node_id: node.id, node_data: cloneDeep(node.data) as HumanInputNodeType }]
  })

  if (blockers.length) return { status: 'blocked', blockers }
  if (!nodes.length) return { status: 'noop' }

  const apiResult = await migrationApi.migrate({ nodes })
  if (apiResult.status === 'blocked') return apiResult

  const expectedNodeIds = new Set(nodes.map((node) => node.node_id))
  const seenNodeIds = new Set<string>()
  const replacements: Extract<HumanInputMigrationPlan, { status: 'ready' }>['replacements'] = []

  for (const item of apiResult.data) {
    if (
      !expectedNodeIds.has(item.node_id) ||
      seenNodeIds.has(item.node_id) ||
      !isHumanInputV2NodeData(item.node_data)
    )
      throw new Error('human-input-migration-invalid-response')
    seenNodeIds.add(item.node_id)
    replacements.push({ nodeId: item.node_id, data: item.node_data })
  }

  if (seenNodeIds.size !== expectedNodeIds.size)
    throw new Error('human-input-migration-invalid-response')

  const currentGraph = getGraph()
  const currentLegacyNodes = currentGraph.nodes.filter((node) => {
    const kind = classifyHumanInputVersion(node.data)
    return (
      kind === HumanInputVersionKind.LegacyEligible || kind === HumanInputVersionKind.LegacyBlocked
    )
  })
  const originalData = new Map(nodes.map((node) => [node.node_id, node.node_data]))
  if (
    !canApply() ||
    currentLegacyNodes.length !== nodes.length ||
    currentLegacyNodes.some((node) => !isEqual(originalData.get(node.id), node.data))
  )
    return { status: 'graph-changed' }

  const replacementData = new Map(replacements.map(({ nodeId, data }) => [nodeId, data]))
  const migratedGraph = {
    ...currentGraph,
    nodes: currentGraph.nodes.map((node) => {
      const data = replacementData.get(node.id)
      if (!data) return node
      const { delivery_methods: _deliveryMethods, ...extensions } = node.data as HumanInputNodeType
      return { ...node, data: { ...extensions, ...cloneDeep(data) } }
    }),
  }
  // Capture exactly what was applied so rollback never overwrites later edits.
  const appliedData = new Map(
    migratedGraph.nodes
      .filter((node) => originalData.has(node.id))
      .map((node) => [node.id, cloneDeep(node.data)]),
  )
  replaceGraph(migratedGraph, 'human-input-v2:migrate')

  try {
    await syncDraft()
  } catch (error) {
    const latestGraph = getGraph()
    replaceGraph(
      {
        ...latestGraph,
        nodes: latestGraph.nodes.map((node) => {
          const data = originalData.get(node.id)
          return data && isEqual(node.data, appliedData.get(node.id))
            ? { ...node, data: cloneDeep(data) }
            : node
        }),
      },
      'human-input-v2:migrate-rollback',
    )
    return { status: 'sync-error', error }
  }
  const migratedNodeIds = replacements.map((replacement) => replacement.nodeId)
  saveHistory(migratedNodeIds)
  return { status: 'success', migratedNodeIds }
}
