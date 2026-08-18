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
  enabled: boolean
  upgrades: KnowledgeUpgrade[]
  requestUpgrade: (dataset: DatasetCardItem, finalFocus?: RefObject<HTMLElement | null>) => void
}

export const KnowledgeUpgradeContext = createContext<KnowledgeUpgradeContextValue>({
  enabled: false,
  upgrades: [],
  requestUpgrade: () => {},
})

export const useKnowledgeUpgrade = () => use(KnowledgeUpgradeContext)
