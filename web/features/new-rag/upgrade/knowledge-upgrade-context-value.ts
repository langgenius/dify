import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { RefObject } from 'react'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import { createContext, use } from 'react'

export type KnowledgeUpgrade = {
  canRetry: boolean
  dataset: DatasetCardItem
  job: KnowledgeFsUpgradeJobResponse
}

type KnowledgeUpgradeContextValue = {
  dismissUpgrade: (jobId: string) => void
  enabled: boolean
  upgrades: KnowledgeUpgrade[]
  requestUpgrade: (dataset: DatasetCardItem, finalFocus?: RefObject<HTMLElement | null>) => void
  settleUpgrade: (upgrade: KnowledgeUpgrade) => void
}

export const KnowledgeUpgradeContext = createContext<KnowledgeUpgradeContextValue>({
  dismissUpgrade: () => {},
  enabled: false,
  upgrades: [],
  requestUpgrade: () => {},
  settleUpgrade: () => {},
})

export const useKnowledgeUpgrade = () => use(KnowledgeUpgradeContext)
