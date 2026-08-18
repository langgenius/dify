'use client'

import type { KnowledgeUpgrade } from './upgrade/knowledge-upgrade-context-value'
import { createLocalStorageState } from 'foxact/create-local-storage-state'

const NEW_KNOWLEDGE_GUIDE_DISMISSED_STORAGE_KEY = 'dify-new-knowledge-guide-dismissed'
export const KNOWLEDGE_UPGRADE_RECOVERY_STORAGE_KEY = 'dify-knowledge-upgrade-recovery'

export type KnowledgeUpgradeRecovery = KnowledgeUpgrade & {
  notified?: boolean
}

type KnowledgeUpgradeRecoveryByWorkspace = Record<string, KnowledgeUpgradeRecovery[]>

const [
  _useNewKnowledgeGuideDismissed,
  useNewKnowledgeGuideDismissedValue,
  useSetNewKnowledgeGuideDismissed,
] = createLocalStorageState<boolean>(NEW_KNOWLEDGE_GUIDE_DISMISSED_STORAGE_KEY, false)

const [useKnowledgeUpgradeRecoveryByWorkspace] =
  createLocalStorageState<KnowledgeUpgradeRecoveryByWorkspace>(
    KNOWLEDGE_UPGRADE_RECOVERY_STORAGE_KEY,
    {},
  )

export {
  useKnowledgeUpgradeRecoveryByWorkspace,
  useNewKnowledgeGuideDismissedValue,
  useSetNewKnowledgeGuideDismissed,
}
