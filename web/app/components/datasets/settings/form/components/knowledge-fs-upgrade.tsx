'use client'

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type Props = {
  datasetId: string
  disabled: boolean
}

const POLL_INTERVAL = 2_000

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const UpgradeProgress = ({
  datasetId,
  initialJob,
}: {
  datasetId: string
  initialJob: KnowledgeFsUpgradeJobResponse
}) => {
  const { t } = useTranslation()
  const [retryError, setRetryError] = useState<string>()
  const jobContract = consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId
  const jobInput = {
    params: {
      dataset_id: datasetId,
      job_id: initialJob.id,
    },
  }
  const {
    data: job,
    error: statusError,
    refetch,
  } = useQuery({
    ...jobContract.get.queryOptions({ input: jobInput }),
    initialData: initialJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'queued' || status === 'running' ? POLL_INTERVAL : false
    },
  })
  const retryMutation = useMutation({
    ...jobContract.post.mutationOptions(),
    onMutate: () => setRetryError(undefined),
    onSuccess: () => void refetch(),
    onError: (error) => setRetryError(getErrorMessage(error)),
  })

  const completed = job.completed_documents + job.completed_sources
  const total = job.total_documents + job.total_sources
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const statusLabel = {
    queued: t(($) => $['newKnowledge.documentStatus.queued'], { ns: 'dataset' }),
    running: t(($) => $['newKnowledge.documentStatus.processing'], { ns: 'dataset' }),
    succeeded: t(($) => $['newKnowledge.processingTaskState.succeeded'], { ns: 'dataset' }),
    failed: t(($) => $['newKnowledge.documentStatus.failed'], { ns: 'dataset' }),
  }[job.status]
  const errorMessage =
    retryError ||
    job.last_error_message ||
    job.last_error_code ||
    (statusError && getErrorMessage(statusError))

  return (
    <div className="flex flex-col gap-y-3 rounded-xl border border-components-panel-border bg-components-panel-bg p-4">
      <div className="flex items-center justify-between gap-x-4">
        <div className="text-sm font-medium text-text-primary">
          {statusLabel}
          <span className="ml-2 text-text-tertiary">{job.stage}</span>
        </div>
        <div className="text-xs text-text-secondary">{progress}%</div>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-components-progress-bar-bg"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full rounded-full bg-components-progress-bar-progress-solid"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex gap-x-5 text-xs text-text-secondary">
        <span>
          {t(($) => $['newKnowledge.documents'], { ns: 'dataset' })}: {job.completed_documents}/
          {job.total_documents}
        </span>
        <span>
          {t(($) => $['newKnowledge.sources'], { ns: 'dataset' })}: {job.completed_sources}/
          {job.total_sources}
        </span>
      </div>
      {errorMessage && (
        <div className="text-xs break-words text-text-destructive">
          {t(($) => $.error, { ns: 'common' })}: {errorMessage}
        </div>
      )}
      {job.status === 'failed' && (
        <div>
          <Button
            size="small"
            variant="secondary"
            loading={retryMutation.isPending}
            onClick={() => retryMutation.mutate(jobInput)}
          >
            {t(($) => $.retry, { ns: 'dataset' })}
          </Button>
        </div>
      )}
    </div>
  )
}

const KnowledgeFSUpgrade = ({ datasetId, disabled }: Props) => {
  const { t } = useTranslation()
  const [job, setJob] = useState<KnowledgeFsUpgradeJobResponse>()
  const [startError, setStartError] = useState<string>()
  const upgradeContract = consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades
  const upgradeInput = { params: { dataset_id: datasetId } }
  const startMutation = useMutation({
    ...upgradeContract.post.mutationOptions(),
    onMutate: () => setStartError(undefined),
    onSuccess: setJob,
    onError: (error) => setStartError(getErrorMessage(error)),
  })

  if (job) return <UpgradeProgress datasetId={datasetId} initialJob={job} />

  return (
    <div className="flex flex-col items-start gap-y-2">
      <Button
        variant="secondary"
        loading={startMutation.isPending}
        disabled={disabled || startMutation.isPending}
        onClick={() => startMutation.mutate(upgradeInput)}
      >
        {t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
      </Button>
      {startError && (
        <div className="text-xs break-words text-text-destructive">
          {t(($) => $.error, { ns: 'common' })}: {startError}
        </div>
      )}
    </div>
  )
}

export default KnowledgeFSUpgrade
