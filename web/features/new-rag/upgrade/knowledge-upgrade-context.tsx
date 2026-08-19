'use client'

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode, RefObject } from 'react'
import type { KnowledgeUpgrade } from './knowledge-upgrade-context-value'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
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
  const [upgrades, setUpgrades] = useState<KnowledgeUpgrade[]>([])
  const dismissUpgrade = useCallback((jobId: string) => {
    setUpgrades((current) => current.filter((entry) => entry.job.id !== jobId))
  }, [])
  const settleUpgrade = useCallback((upgrade: KnowledgeUpgrade) => {
    setUpgrades((current) => {
      const existingIndex = current.findIndex((entry) => entry.job.id === upgrade.job.id)
      if (existingIndex === -1) return [upgrade, ...current]

      return current.map((entry, index) => (index === existingIndex ? upgrade : entry))
    })
  }, [])

  const handleStarted = (dataset: DatasetCardItem, job: KnowledgeFsUpgradeJobResponse) => {
    setUpgrades((current) => [
      { canRetry: false, dataset, job },
      ...current.filter((entry) => entry.dataset.id !== dataset.id),
    ])
    void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
    void queryClient.invalidateQueries({
      queryKey: consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
    })
    setCandidate(undefined)
    onUpgradeStarted()
  }

  return (
    <KnowledgeUpgradeContext
      value={{
        dismissUpgrade,
        enabled: true,
        upgrades,
        requestUpgrade: (dataset, finalFocus) => setCandidate({ dataset, finalFocus }),
        settleUpgrade,
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
