import type { HumanInputNodeType } from '../../human-input/types'
import type { CommonNodeType, Node } from '@/app/components/workflow/types'
import { zFormInputConfig } from '@dify/contracts/api/console/workspaces/zod.gen'
import { BlockEnum } from '@/app/components/workflow/types'
import { ENABLE_HITL_IM } from '@/config'

export const HumanInputVersionKind = {
  NotHumanInput: 'not-human-input',
  V2: 'v2',
  LegacyEligible: 'legacy-eligible',
  LegacyBlocked: 'legacy-blocked',
} as const

export type HumanInputVersionKind =
  (typeof HumanInputVersionKind)[keyof typeof HumanInputVersionKind]

export type HumanInputCreationPolicy = {
  hasLegacyHumanInput: boolean
  canAddHumanInputV2: boolean
  canAddLegacyHumanInput: boolean
  candidateCount: 1
}

export const classifyHumanInputVersion = (data: CommonNodeType): HumanInputVersionKind => {
  if (data.type !== BlockEnum.HumanInput) return HumanInputVersionKind.NotHumanInput

  const version = (data as { version?: unknown }).version
  if (version === '2') return HumanInputVersionKind.V2
  if (version === undefined || version === '1') return HumanInputVersionKind.LegacyEligible
  return HumanInputVersionKind.LegacyBlocked
}

export const isLegacyHumanInputNodeData = (data: CommonNodeType): boolean => {
  const kind = classifyHumanInputVersion(data)
  return (
    kind === HumanInputVersionKind.LegacyEligible || kind === HumanInputVersionKind.LegacyBlocked
  )
}

const isSupportedLegacyInputType = (type: unknown) =>
  type === 'text_input' ||
  zFormInputConfig.options.some((schema) => schema.shape.type.safeParse(type).success)

export const getUnsupportedLegacyHumanInputFields = (data: CommonNodeType) => {
  if (classifyHumanInputVersion(data) !== HumanInputVersionKind.LegacyEligible) return []
  return ((data as HumanInputNodeType).inputs ?? []).filter(
    (input) => !isSupportedLegacyInputType(input.type),
  )
}

export const getHumanInputCreationPolicy = (
  nodes: Pick<Node, 'data'>[],
  canEdit: boolean,
): HumanInputCreationPolicy => {
  const hasLegacyHumanInput = nodes.some((node) => isLegacyHumanInputNodeData(node.data))
  if (!ENABLE_HITL_IM) {
    return {
      hasLegacyHumanInput,
      canAddHumanInputV2: false,
      canAddLegacyHumanInput:
        canEdit &&
        nodes.every((node) => {
          const kind = classifyHumanInputVersion(node.data)
          return kind !== HumanInputVersionKind.V2 && kind !== HumanInputVersionKind.LegacyBlocked
        }),
      candidateCount: 1,
    }
  }
  const canContinueLegacy =
    nodes.some((node) => getUnsupportedLegacyHumanInputFields(node.data).length > 0) &&
    nodes.every((node) => {
      const kind = classifyHumanInputVersion(node.data)
      return kind !== HumanInputVersionKind.V2 && kind !== HumanInputVersionKind.LegacyBlocked
    })

  return {
    hasLegacyHumanInput,
    canAddHumanInputV2: canEdit && !hasLegacyHumanInput,
    canAddLegacyHumanInput: canEdit && canContinueLegacy,
    candidateCount: 1,
  }
}

const isHumanInputInsertion = (
  nodeType: BlockEnum,
  data?: Pick<CommonNodeType, 'type'> & { version?: unknown },
): boolean => {
  if (nodeType === BlockEnum.HumanInput || nodeType === BlockEnum.HumanInputV2) return true
  return data?.type === BlockEnum.HumanInput
}

export const canInsertHumanInput = (
  nodes: Pick<Node, 'data'>[],
  nodeType: BlockEnum,
  data?: Pick<CommonNodeType, 'type'> & { version?: unknown },
): boolean => {
  if (!isHumanInputInsertion(nodeType, data)) return true
  if (data?.version !== undefined && data.version !== '1' && data.version !== '2') return false
  const policy = getHumanInputCreationPolicy(nodes, true)
  if (nodeType === BlockEnum.HumanInputV2 || data?.version === '2') return policy.canAddHumanInputV2
  if (!ENABLE_HITL_IM) return policy.canAddLegacyHumanInput
  return (
    !nodes.some((node) => classifyHumanInputVersion(node.data) === HumanInputVersionKind.V2) &&
    (!policy.hasLegacyHumanInput || policy.canAddLegacyHumanInput)
  )
}

export const canInsertHumanInputNodes = (
  nodes: Pick<Node, 'data'>[],
  incomingNodes: Pick<Node, 'data'>[],
): boolean => {
  const humanInputNodes = incomingNodes.filter((node) =>
    isHumanInputInsertion(node.data.type, node.data),
  )
  const hasIncomingV2 = humanInputNodes.some(
    (node) =>
      node.data.type === BlockEnum.HumanInputV2 ||
      classifyHumanInputVersion(node.data) === HumanInputVersionKind.V2,
  )
  const hasIncomingLegacy = humanInputNodes.some((node) => isLegacyHumanInputNodeData(node.data))
  if (hasIncomingV2 && hasIncomingLegacy) return false
  return humanInputNodes.every((node) => canInsertHumanInput(nodes, node.data.type, node.data))
}
