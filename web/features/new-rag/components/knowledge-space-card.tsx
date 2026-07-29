import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { newKnowledgeOverviewPath } from '../routes'
import { KnowledgeSpaceActions } from './knowledge-space-actions'
import { KnowledgeSpaceIcon } from './knowledge-space-icon'

function getBuiltinIconName(iconRef: string | undefined) {
  if (!iconRef?.startsWith('builtin:')) return undefined
  return iconRef.slice('builtin:'.length).replaceAll('-', ' ')
}

export function KnowledgeSpaceCard({
  knowledgeSpace,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
}) {
  const { t } = useTranslation('dataset')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const unavailable = t(($) => $['cornerLabel.unavailable'])
  const summary = knowledgeSpace.technical_summary
  const name = summary?.name ?? knowledgeSpace.control_space_id
  const iconName = getBuiltinIconName(summary?.icon ?? undefined)
  const updatedAt = Date.parse(knowledgeSpace.updated_at)
  const formattedUpdatedAt = Number.isNaN(updatedAt)
    ? knowledgeSpace.updated_at
    : formatTimeFromNow(updatedAt)

  return (
    <li className="group relative">
      <Link
        href={newKnowledgeOverviewPath(knowledgeSpace.control_space_id)}
        aria-label={name}
        className="relative flex h-[166px] w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg text-left shadow-xs outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-state-accent-solid motion-reduce:transition-none"
      >
        <div className="flex w-full items-center gap-3 px-4 pt-4 pb-1.5">
          <div
            aria-label={iconName ?? t(($) => $['newKnowledge.cardType'])}
            title={iconName}
            className="shrink-0"
          >
            <KnowledgeSpaceIcon icon={summary?.icon} size="large" />
          </div>
          <div className="min-w-0 flex-1 py-px">
            <h2 className="truncate system-md-semibold text-text-secondary">{name}</h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-1 system-2xs-medium-uppercase text-text-disabled">
              <span className="truncate">{t(($) => $['newKnowledge.cardType'])}</span>
            </div>
          </div>
        </div>
        <p className="line-clamp-2 min-h-8 w-full px-4 py-0.5 body-xs-regular text-text-tertiary">
          {summary?.description || t(($) => $['newKnowledge.noDescription'])}
        </p>
        <div
          aria-label={`${t(($) => $['newKnowledge.tags'])}. ${unavailable}`}
          className="mt-1 flex min-w-0 items-center gap-1 px-4"
        >
          <span className="rounded-md bg-background-section px-1.5 py-0.5 system-2xs-medium-uppercase text-text-disabled">
            {t(($) => $['newKnowledge.tags'])}
          </span>
          <span className="system-2xs-regular text-text-disabled">{unavailable}</span>
        </div>
        <div className="mt-auto flex w-full min-w-0 items-center gap-2 px-4 pt-1 pb-2.5 system-xs-regular text-text-tertiary">
          <span className="flex shrink-0 items-center gap-1 text-text-disabled">
            <span aria-hidden className="i-ri-file-text-line size-3.5" />
            <span>{summary?.document_count ?? 0}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-text-disabled">
            <span aria-hidden className="i-ri-robot-2-line size-3.5" />
            <span aria-hidden>—</span>
            <span className="sr-only">{t(($) => $['newKnowledge.appsUnavailable'])}</span>
          </span>
          <span aria-hidden className="text-divider-deep">
            /
          </span>
          <span className="ml-auto min-w-0 truncate text-right">
            {t(($) => $['newKnowledge.updated'], {
              date: formattedUpdatedAt,
            })}
          </span>
        </div>
      </Link>
      <KnowledgeSpaceActions knowledgeSpace={knowledgeSpace} />
    </li>
  )
}
