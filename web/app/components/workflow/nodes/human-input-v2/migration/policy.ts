import type { CommonNodeType, Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

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

export const isMigrationEligibleHumanInputNodeData = (data: CommonNodeType): boolean =>
  classifyHumanInputVersion(data) === HumanInputVersionKind.LegacyEligible

export const getHumanInputCreationPolicy = (
  nodes: Pick<Node, 'data'>[],
  canEdit: boolean,
): HumanInputCreationPolicy => {
  const hasLegacyHumanInput = nodes.some((node) => isLegacyHumanInputNodeData(node.data))

  return {
    hasLegacyHumanInput,
    canAddHumanInputV2: canEdit && !hasLegacyHumanInput,
    candidateCount: 1,
  }
}

export const isHumanInputInsertion = (
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
  return !getHumanInputCreationPolicy(nodes, true).hasLegacyHumanInput
}
