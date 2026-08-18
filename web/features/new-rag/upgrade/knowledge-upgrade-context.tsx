'use client'

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode, RefObject } from 'react'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { consoleQuery } from '@/service/client'
import { KnowledgeUpgradeContext } from './knowledge-upgrade-context-value'
import { KnowledgeUpgradeDialog } from './knowledge-upgrade-dialog'

type UpgradeCandidate = {
  dataset: DatasetCardItem
  finalFocus?: RefObject<HTMLElement | null>
}

export function KnowledgeUpgradeProvider({
  children,
  onUpgradeStarted,
}: {
  children: ReactNode
  onUpgradeStarted: () => void
}) {
  const queryClient = useQueryClient()
  const [candidate, setCandidate] = useState<UpgradeCandidate>()
  const [upgrades, setUpgrades] = useState<
    Array<{ canRetry: boolean; dataset: DatasetCardItem; job: KnowledgeFsUpgradeJobResponse }>
  >([])

  const handleStarted = (dataset: DatasetCardItem, job: KnowledgeFsUpgradeJobResponse) => {
    setUpgrades((current) => [
      { canRetry: false, dataset, job },
      ...current.filter((entry) => entry.dataset.id !== dataset.id),
    ])
    void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
    setCandidate(undefined)
    onUpgradeStarted()
  }

  return (
    <KnowledgeUpgradeContext
      value={{
        enabled: true,
        upgrades,
        requestUpgrade: (dataset, finalFocus) => setCandidate({ dataset, finalFocus }),
      }}
    >
      {children}
      <KnowledgeUpgradeDialog
        dataset={candidate?.dataset}
        finalFocus={candidate?.finalFocus}
        onCancel={() => setCandidate(undefined)}
        onStarted={handleStarted}
      />
    </KnowledgeUpgradeContext>
  )
}
