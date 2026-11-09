import type { NodeDataMigrationBlocker } from '@dify/contracts/api/console/workspaces/types.gen'
import type { HumanInputNodeType } from '../../human-input/types'
import type { HumanInputV2NodeType } from '../types'
import type { Edge, Node } from '@/app/components/workflow/types'

type HumanInputMigrationApiRequest = {
  nodes: Array<{
    node_id: string
    node_data: HumanInputNodeType
  }>
}

type HumanInputMigrationApiResult =
  | {
      status: 'success'
      data: Array<{
        node_id: string
        node_data: HumanInputV2NodeType
      }>
    }
  | {
      status: 'blocked'
      blockers: HumanInputMigrationBlocker[]
    }

export type HumanInputMigrationApi = {
  migrate: (request: HumanInputMigrationApiRequest) => Promise<HumanInputMigrationApiResult>
}

export const HumanInputMigrationBlockerCode = {
  UnsupportedVersion: 'unsupported-version',
  UnsupportedInputType: 'unsupported-input-type',
  ConfiguredDisabledMethod: 'configured-disabled-method',
  UnsupportedDeliveryMethod: 'unsupported-delivery-method',
  InvalidEmailConfiguration: 'invalid-email-configuration',
  InvalidEmail: 'invalid-email',
  InvalidDefaultValue: 'invalid-default-value',
  UnresolvedMember: 'unresolved-member',
  ConflictingEmailTemplates: 'conflicting-email-templates',
  MissingRecipients: 'missing-recipients',
} as const

export type HumanInputMigrationBlockerCode =
  | NodeDataMigrationBlocker['code']
  | typeof HumanInputMigrationBlockerCode.UnsupportedInputType

export type HumanInputMigrationBlocker = {
  nodeId: string
  nodeTitle: string
  methodId?: string
} & (
  | { code: NodeDataMigrationBlocker['code']; value?: string }
  | { code: typeof HumanInputMigrationBlockerCode.UnsupportedInputType; value: string }
)

type HumanInputMigrationReplacement = {
  nodeId: string
  data: HumanInputV2NodeType
}

export type HumanInputMigrationPlan =
  | {
      status: 'ready'
      replacements: HumanInputMigrationReplacement[]
    }
  | {
      status: 'blocked'
      blockers: HumanInputMigrationBlocker[]
    }

export type HumanInputMigrationGraph = {
  nodes: Node[]
  edges: Edge[]
}
