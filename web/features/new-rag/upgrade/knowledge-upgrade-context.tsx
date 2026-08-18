'use client'

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode, RefObject } from 'react'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import type { KnowledgeUpgradeRecovery } from '@/features/new-rag/storage'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { useKnowledgeUpgradeRecoveryByWorkspace } from '@/features/new-rag/storage'
import { consoleQuery } from '@/service/client'
import { KnowledgeUpgradeContext } from './knowledge-upgrade-context-value'
import { KnowledgeUpgradeDialog } from './knowledge-upgrade-dialog'

const UPGRADE_POLL_INTERVAL = 2_000

const isActiveUpgrade = (status: KnowledgeFsUpgradeJobResponse['status']) =>
  status === 'queued' || status === 'running'

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
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const [candidate, setCandidate] = useState<UpgradeCandidate>()
  const [upgradeRecoveryByWorkspace, setUpgradeRecoveryByWorkspace] =
    useKnowledgeUpgradeRecoveryByWorkspace()
  const upgradeEntries = useMemo(
    () => upgradeRecoveryByWorkspace[currentWorkspaceId] ?? [],
    [currentWorkspaceId, upgradeRecoveryByWorkspace],
  )
  const notifiedJobsRef = useRef(new Set<string>())
  const jobResults = useQueries({
    queries: upgradeEntries.map(({ job }) => ({
      ...consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get.queryOptions({
        input: {
          params: {
            dataset_id: job.old_dataset_id,
            job_id: job.id,
          },
        },
      }),
      initialData: job,
      refetchInterval: (query: { state: { data?: KnowledgeFsUpgradeJobResponse } }) =>
        query.state.data && isActiveUpgrade(query.state.data.status)
          ? UPGRADE_POLL_INTERVAL
          : false,
    })),
  })
  const upgrades = upgradeEntries.map((entry, index) => ({
    ...entry,
    job: jobResults[index]?.data ?? entry.job,
  }))
  const upgradesRef = useRef(upgrades)
  upgradesRef.current = upgrades
  const upgradeStatusKey = upgrades
    .map(({ job, notified }) =>
      [job.id, job.status, job.completed_documents, job.new_control_space_id, notified].join(':'),
    )
    .join('|')

  const updateUpgradeEntries = useCallback(
    (update: (current: KnowledgeUpgradeRecovery[]) => KnowledgeUpgradeRecovery[]) => {
      setUpgradeRecoveryByWorkspace((current) => {
        const recoveryByWorkspace = current ?? {}
        return {
          ...recoveryByWorkspace,
          [currentWorkspaceId]: update(recoveryByWorkspace[currentWorkspaceId] ?? []),
        }
      })
    },
    [currentWorkspaceId, setUpgradeRecoveryByWorkspace],
  )

  useEffect(() => {
    const completedUpgrades = upgradesRef.current.filter(
      ({ job, notified }) =>
        !isActiveUpgrade(job.status) && !notified && !notifiedJobsRef.current.has(job.id),
    )
    if (completedUpgrades.length === 0) return

    completedUpgrades.forEach(({ dataset, job }) => {
      notifiedJobsRef.current.add(job.id)

      if (job.status === 'succeeded') {
        toast.success(
          t(($) => $['newKnowledge.upgrade.completeTitle']),
          {
            description: t(($) => $['newKnowledge.upgrade.completeDescription'], {
              name: dataset.name,
            }),
          },
        )
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
        })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
        return
      }

      toast.error(
        t(($) => $['newKnowledge.upgrade.failedTitle']),
        {
          description: t(($) => $['newKnowledge.upgrade.failedToastDescription'], {
            name: dataset.name,
          }),
        },
      )
    })

    const completedJobs = new Map(completedUpgrades.map(({ job }) => [job.id, job]))
    updateUpgradeEntries((current) =>
      current.map((entry) => {
        const completedJob = completedJobs.get(entry.job.id)
        return completedJob ? { ...entry, job: completedJob, notified: true } : entry
      }),
    )
  }, [queryClient, t, updateUpgradeEntries, upgradeStatusKey])

  const handleStarted = (dataset: DatasetCardItem, job: KnowledgeFsUpgradeJobResponse) => {
    updateUpgradeEntries((current) => [
      { dataset, job },
      ...current.filter((entry) => entry.dataset.id !== dataset.id),
    ])
    setCandidate(undefined)
    onUpgradeStarted()
  }

  return (
    <KnowledgeUpgradeContext
      value={{
        enabled: true,
        upgrades,
        dismissUpgrade: (datasetId) =>
          updateUpgradeEntries((current) =>
            current.filter((entry) => entry.dataset.id !== datasetId),
          ),
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
