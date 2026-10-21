import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { KnowledgeSpaceIcon } from '../components/knowledge-space-icon'
import { newKnowledgeOverviewPath } from '../routes'
import { KnowledgeSpaceActions } from './knowledge-space-actions'
import { KnowledgeSpaceCardTags } from './knowledge-space-card-tags'

function getBuiltinIconName(iconRef: string | undefined) {
  if (!iconRef?.startsWith('builtin:')) return undefined
  return iconRef.slice('builtin:'.length).replaceAll('-', ' ')
}

export function KnowledgeSpaceCard({
  knowledgeSpace,
  onOpenTagManagement,
  highlighted = false,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
  onOpenTagManagement: () => void
  highlighted?: boolean
}) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeOverview'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const nameId = useId()
  const descriptionId = useId()
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
    <li
      className={cn(
        "group relative isolate h-41.5 overflow-hidden rounded-xl bg-components-card-bg text-left transition-[background-color,box-shadow] after:pointer-events-none after:absolute after:inset-0 after:z-1 after:rounded-xl after:content-[''] focus-within:bg-components-card-bg-alt focus-within:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] hover:bg-components-card-bg-alt hover:shadow-md hover:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] has-data-popup-open:bg-components-card-bg-alt has-data-popup-open:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] has-[>a:focus-visible]:after:inset-ring-2 has-[>a:focus-visible]:after:inset-ring-state-accent-solid motion-reduce:transition-none [@media(hover:none)]:bg-components-card-bg-alt [@media(hover:none)]:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)]",
        highlighted
          ? 'border-2 border-state-accent-solid shadow-[0_0_12px_4px_rgba(21,94,239,0.18)]'
          : 'border-[0.5px] border-components-card-border shadow-xs',
      )}
    >
      <Link
        href={newKnowledgeOverviewPath(knowledgeSpace.control_space_id)}
        aria-labelledby={nameId}
        aria-describedby={`${descriptionId} ${linkedAppsDescriptionId}`}
        className="flex h-full touch-manipulation flex-col rounded-xl outline-hidden"
      >
        <div className="flex w-full items-center gap-3 px-4 pt-4 pb-1.5">
          <div title={iconName} className="shrink-0">
            <KnowledgeSpaceIcon
              background={summary?.icon_background}
              icon={summary?.icon}
              size="large"
            />
          </div>
          <div className="min-w-0 flex-1 py-px">
            <h2 id={nameId} className="truncate system-md-semibold text-text-secondary">
              {name}
            </h2>
          </div>
        </div>
        <p
          id={descriptionId}
          className="line-clamp-2 min-h-8 w-full px-4 py-0.5 body-xs-regular wrap-break-word text-text-tertiary"
        >
          {summary?.description || t(($) => $.noDescription)}
        </p>
        <div className="mt-auto flex w-full min-w-0 items-center gap-2 px-4 pt-1 pb-2.5 system-xs-regular text-text-tertiary">
          <span className="flex shrink-0 items-center gap-1 text-text-disabled">
            <span aria-hidden className="i-ri-file-text-line size-3.5" />
            <span>{summary?.document_count ?? 0}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-text-disabled">
            <span aria-hidden className="i-ri-robot-2-line size-3.5" />
            <span aria-hidden>{linkedApps}</span>
            <span id={linkedAppsDescriptionId} className="sr-only">
              {t(($) => $['overview.linkedApps'], { ns: 'knowledgeOverview' })}: {linkedApps}
            </span>
          </span>
          <span className="ml-auto min-w-0 truncate text-right">
            {t(($) => $.updated, {
              date: formattedUpdatedAt,
            })}
          </span>
        </div>
      </Link>
      <div className="absolute top-25 right-3 left-3 flex h-6.5 min-w-0 items-start">
        <KnowledgeSpaceCardTags
          knowledgeSpace={knowledgeSpace}
          onOpenTagManagement={onOpenTagManagement}
        />
      </div>
      <KnowledgeSpaceActions knowledgeSpace={knowledgeSpace} />
    </li>
  )
}
