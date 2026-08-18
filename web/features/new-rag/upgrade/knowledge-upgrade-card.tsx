'use client'

import type { KnowledgeUpgrade } from './knowledge-upgrade-context-value'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import DatasetCardHeader from '@/app/components/datasets/list/dataset-card/components/dataset-card-header'
import Link from '@/next/link'
import { newKnowledgeOverviewPath } from '../routes'
import { useKnowledgeUpgrade } from './knowledge-upgrade-context-value'

const isActiveUpgrade = (status: KnowledgeUpgrade['job']['status']) =>
  status === 'queued' || status === 'running'

export function KnowledgeUpgradeCard({ upgrade }: { upgrade: KnowledgeUpgrade }) {
  const { t } = useTranslation('dataset')
  const { dismissUpgrade } = useKnowledgeUpgrade()
  const { dataset, job } = upgrade
  const active = isActiveUpgrade(job.status)
  const failed = job.status === 'failed'
  const succeeded = job.status === 'succeeded'
  const contentOpacity = active || failed ? 'opacity-30' : undefined
  const totalDocuments = job.total_documents || dataset.document_count
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
        {failed ? t(($) => $['newKnowledge.upgrade.failedDescription']) : dataset.description}
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
        <span className="flex shrink-0 items-center gap-1 system-xs-medium">
          <span aria-hidden className="i-ri-file-text-fill size-3 text-text-quaternary" />
          {active ? `${job.completed_documents}/${totalDocuments}` : totalDocuments}
        </span>
        <span className="flex shrink-0 items-center gap-1 system-xs-medium">
          <span aria-hidden className="i-ri-robot-2-fill size-3 text-text-quaternary" />
          {dataset.app_count}
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
          <Button size="small" onClick={() => dismissUpgrade(dataset.id)}>
            {t(($) => $['newKnowledge.upgrade.dismiss'])}
          </Button>
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
        succeeded
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
