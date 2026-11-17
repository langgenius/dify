import type { TFunction } from 'i18next'
import type { HumanInputInsertionBlocker } from './policy'
import { toast } from '@/app/notifications'

const reasonKeys = {
  disabled: 'nodes.humanInputV2.disabled',
  'unsupported-version': 'nodes.humanInputMigration.blocker.unsupportedVersion',
  'migration-required': 'nodes.humanInputMigration.disabledReason',
  'incompatible-versions': 'nodes.humanInputMigration.incompatibleVersions',
} as const

export const notifyHumanInputInsertionBlocked = (
  reason: HumanInputInsertionBlocker,
  t: TFunction<['workflow']>,
) => {
  toast.warning(t(($) => $[reasonKeys[reason]], { ns: 'workflow' }))
}
