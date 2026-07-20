import type { HumanInputV2NodeType } from '../types'
import type { Edge, Node } from '@/app/components/workflow/types'

export type MigrationMember = {
  id: string
  email?: string | null
}

export type MigrationContact = {
  id: string
  email: string
}

export type HumanInputMigrationResolverSnapshot = {
  members: readonly MigrationMember[]
  contacts: readonly MigrationContact[]
}

export const HumanInputMigrationBlockerCode = {
  UnsupportedVersion: 'unsupported-version',
  ConfiguredDisabledMethod: 'configured-disabled-method',
  UnsupportedDeliveryMethod: 'unsupported-delivery-method',
  InvalidEmailConfiguration: 'invalid-email-configuration',
  InvalidEmail: 'invalid-email',
  UnresolvedMember: 'unresolved-member',
  ConflictingEmailTemplates: 'conflicting-email-templates',
  MissingRecipients: 'missing-recipients',
} as const

export type HumanInputMigrationBlockerCode =
  (typeof HumanInputMigrationBlockerCode)[keyof typeof HumanInputMigrationBlockerCode]

export type HumanInputMigrationBlocker = {
  nodeId: string
  nodeTitle: string
  code: HumanInputMigrationBlockerCode
  methodId?: string
  value?: string
}

export type HumanInputMigrationReplacement = {
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
