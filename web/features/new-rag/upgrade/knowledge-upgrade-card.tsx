'use client'

import type { KnowledgeUpgrade } from './knowledge-upgrade-context-value'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import DatasetCardHeader from '@/app/components/datasets/list/dataset-card/components/dataset-card-header'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { newKnowledgeOverviewPath } from '../routes'

const UPGRADE_POLL_INTERVAL = 2_000

const isActiveUpgrade = (status: KnowledgeUpgrade['job']['status']) =>
  status === 'queued' || status === 'running'

export function KnowledgeUpgradeCard({
  upgrade,
  highlighted = false,
  onSucceeded,
}: {
  upgrade: KnowledgeUpgrade
  highlighted?: boolean
  onSucceeded?: (controlSpaceId: string) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const { canRetry, dataset } = upgrade
  const jobInput = {
    params: {
      dataset_id: upgrade.job.old_dataset_id,
      job_id: upgrade.job.id,
    },
  }
  const { data: job, refetch } = useQuery({
    ...consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get.queryOptions({
      input: jobInput,
    }),
    initialData: upgrade.job,
    refetchInterval: (query) =>
      query.state.data && isActiveUpgrade(query.state.data.status) ? UPGRADE_POLL_INTERVAL : false,
  })
  const retryMutation = useMutation({
    ...consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.post.mutationOptions(),
    onSuccess: () => {
      void refetch()
      void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
    },
  })
  const previousStatusRef = useRef(job.status)

  useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = job.status
    if (!isActiveUpgrade(previousStatus) || isActiveUpgrade(job.status)) return

    void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
    if (job.status === 'succeeded') {
      if (job.new_control_space_id) onSucceeded?.(job.new_control_space_id)
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
  }, [dataset.name, job.new_control_space_id, job.status, onSucceeded, queryClient, t])

  const active = isActiveUpgrade(job.status)
  const failed = job.status === 'failed'
  const succeeded = job.status === 'succeeded'
  const contentOpacity = active || failed ? 'opacity-30' : undefined
  const totalDocuments = job.total_documents || dataset.document_count
  const totalSources = job.total_sources
  const failureMessage = job.last_error_message || job.last_error_code
  const cardContent = (
    <>
      <div className={contentOpacity}>
        <DatasetCardHeader dataset={dataset} />
      </div>
      <p
        className={cn(
          'line-clamp-2 min-h-10 px-4 py-1 system-xs-regular text-text-tertiary',
          contentOpacity,
        )}
      >
        {failed
          ? failureMessage || t(($) => $['newKnowledge.upgrade.failedDescription'])
          : dataset.description}
      </p>
      <div className={cn('flex h-6 min-w-0 gap-1 overflow-hidden px-4 py-1', contentOpacity)}>
        {dataset.tags.slice(0, 3).map((tag) => (
          <span
            key={tag.id}
            className="shrink-0 rounded-[5px] border border-divider-deep px-1.25 py-0.75 system-2xs-medium-uppercase text-text-tertiary"
          >
            {tag.name}
          </span>
        ))}
      </div>
      <div
        className={cn(
          'mt-auto flex min-w-0 items-center gap-3 px-4 pt-2 pb-3 system-xs-regular text-text-tertiary',
          contentOpacity,
        )}
      >
        <span
          className="flex shrink-0 items-center gap-1 system-xs-medium"
          aria-label={`${t(($) => $['newKnowledge.documents'])}: ${active ? `${job.completed_documents}/${totalDocuments}` : totalDocuments}`}
        >
          <span aria-hidden className="i-ri-file-text-fill size-3 text-text-quaternary" />
          {active ? `${job.completed_documents}/${totalDocuments}` : totalDocuments}
        </span>
        <span
          className="flex shrink-0 items-center gap-1 system-xs-medium"
          aria-label={`${t(($) => $['newKnowledge.sources'])}: ${active ? `${job.completed_sources}/${totalSources}` : totalSources}`}
        >
          <span aria-hidden className="i-ri-database-2-fill size-3 text-text-quaternary" />
          {active ? `${job.completed_sources}/${totalSources}` : totalSources}
        </span>
        <span aria-hidden className="text-divider-deep">
          /
        </span>
        <span className="min-w-0 truncate">
          {active
            ? t(($) => $['newKnowledge.upgrade.migratingDocuments'])
            : failed
              ? t(($) => $['newKnowledge.upgrade.justNow'])
              : t(($) => $['newKnowledge.upgrade.upgradedJustNow'])}
        </span>
      </div>
      {(active || failed) && (
        <div
          className={cn(
            'absolute top-0 right-0 flex h-5 items-center gap-0.5 rounded-bl-lg px-2 system-2xs-medium-uppercase',
            active
              ? 'bg-util-colors-indigo-indigo-200 text-util-colors-indigo-indigo-700'
              : 'bg-util-colors-red-red-100 text-util-colors-red-red-600',
          )}
        >
          {active && (
            <span
              aria-hidden
              className="i-ri-loader-2-line size-3 animate-spin motion-reduce:animate-none"
            />
          )}
          {active
            ? t(($) => $['newKnowledge.upgrade.statusUpgrading'])
            : t(($) => $['newKnowledge.upgrade.statusFailed'])}
        </div>
      )}
      {failed && (
        <div className="absolute inset-x-0 bottom-0 flex h-14 items-end justify-end gap-1 bg-gradient-to-b from-transparent to-components-card-bg p-2">
          {canRetry && (
            <Button
              size="small"
              loading={retryMutation.isPending}
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate(jobInput)}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          )}
          <a
            href="mailto:support@dify.ai"
            className={buttonVariants({ variant: 'secondary-accent', size: 'small' })}
          >
            {t(($) => $['newKnowledge.upgrade.contactSupport'])}
          </a>
        </div>
      )}
    </>
  )

  return (
    <li
      className={cn(
        'relative flex h-41.5 flex-col overflow-hidden rounded-xl bg-components-card-bg shadow-xs',
        highlighted
          ? 'border-2 border-state-accent-solid shadow-[0_0_12px_4px_rgba(21,94,239,0.18)]'
          : 'border-[0.5px] border-components-card-border',
      )}
    >
      {succeeded && job.new_control_space_id ? (
        <Link
          href={newKnowledgeOverviewPath(job.new_control_space_id)}
          aria-label={dataset.name}
          className="flex h-full flex-col rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          {cardContent}
        </Link>
      ) : (
        cardContent
      )}
    </li>
  )
}
