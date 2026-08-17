import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { newKnowledgeOverviewPath } from '../routes'
import { KnowledgeSpaceActions } from './knowledge-space-actions'
import { KnowledgeSpaceCardTags } from './knowledge-space-card-tags'
import { KnowledgeSpaceIcon } from './knowledge-space-icon'

function getBuiltinIconName(iconRef: string | undefined) {
  if (!iconRef?.startsWith('builtin:')) return undefined
  return iconRef.slice('builtin:'.length).replaceAll('-', ' ')
}

export function KnowledgeSpaceCard({
  knowledgeSpace,
  onOpenTagManagement,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
  onOpenTagManagement: () => void
}) {
  const { t } = useTranslation('dataset')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const linkedAppsDescriptionId = useId()
  const summary = knowledgeSpace.technical_summary
  const name = summary?.name ?? knowledgeSpace.control_space_id
  const linkedApps = knowledgeSpace.linked_apps
  const iconName = getBuiltinIconName(summary?.icon ?? undefined)
  const updatedAt = Date.parse(knowledgeSpace.updated_at)
  const formattedUpdatedAt = Number.isNaN(updatedAt)
    ? knowledgeSpace.updated_at
    : formatTimeFromNow(updatedAt)

  return (
    <li className="group relative flex h-41.5 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg text-left shadow-xs outline-hidden transition-shadow hover:shadow-md motion-reduce:transition-none">
      <Link
        href={newKnowledgeOverviewPath(knowledgeSpace.control_space_id)}
        aria-label={name}
        aria-describedby={linkedAppsDescriptionId}
        className="block outline-hidden after:absolute after:inset-0 after:z-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-state-accent-solid"
      >
        <div className="relative z-1 flex w-full items-center gap-3 px-4 pt-4 pb-1.5">
          <div
            aria-label={iconName ?? t(($) => $['newKnowledge.cardType'])}
            title={iconName}
            className="shrink-0"
          >
            <KnowledgeSpaceIcon
              background={summary?.icon_background}
              icon={summary?.icon}
              size="large"
            />
          </div>
          <div className="min-w-0 flex-1 py-px">
            <h2 className="truncate system-md-semibold text-text-secondary">{name}</h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-1 system-2xs-medium-uppercase text-text-disabled">
              <span className="truncate">{t(($) => $['newKnowledge.cardType'])}</span>
            </div>
          </div>
        </div>
        <p className="relative z-1 line-clamp-2 min-h-8 w-full px-4 py-0.5 body-xs-regular text-text-tertiary">
          {summary?.description || t(($) => $['newKnowledge.noDescription'])}
        </p>
      </Link>
      <KnowledgeSpaceCardTags
        knowledgeSpace={knowledgeSpace}
        onOpenTagManagement={onOpenTagManagement}
      />
      <div className="pointer-events-none relative z-1 mt-auto flex w-full min-w-0 items-center gap-2 px-4 pt-1 pb-2.5 system-xs-regular text-text-tertiary">
        <span className="flex shrink-0 items-center gap-1 text-text-disabled">
          <span aria-hidden className="i-ri-file-text-line size-3.5" />
          <span>{summary?.document_count ?? 0}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-text-disabled">
          <span aria-hidden className="i-ri-robot-2-line size-3.5" />
          <span aria-hidden>{linkedApps}</span>
          <span id={linkedAppsDescriptionId} className="sr-only">
            {t(($) => $['newKnowledge.overview.linkedApps'])}: {linkedApps}
          </span>
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
      <KnowledgeSpaceActions knowledgeSpace={knowledgeSpace} />
    </li>
  )
}
