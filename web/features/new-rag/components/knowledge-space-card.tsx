import type { KnowledgeSpace } from '@dify/contracts/knowledge-fs/types.gen'
import { useTranslation } from 'react-i18next'
import CornerLabel from '@/app/components/base/corner-label'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

function getBuiltinIconName(iconRef: string | undefined) {
  if (!iconRef?.startsWith('builtin:')) return undefined
  return iconRef.slice('builtin:'.length).replaceAll('-', ' ')
}

export function KnowledgeSpaceCard({ knowledgeSpace }: { knowledgeSpace: KnowledgeSpace }) {
  const { t } = useTranslation('dataset')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const unavailable = t(($) => $['cornerLabel.unavailable'])
  const iconName = getBuiltinIconName(knowledgeSpace.iconRef)
  const updatedAt = Date.parse(knowledgeSpace.updatedAt)
  const formattedUpdatedAt = Number.isNaN(updatedAt)
    ? knowledgeSpace.updatedAt
    : formatTimeFromNow(updatedAt)

  return (
    <li>
      <article
        aria-label={`${knowledgeSpace.name}. ${unavailable}`}
        className="relative flex h-[166px] w-full cursor-not-allowed flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg text-left shadow-xs"
      >
        <CornerLabel
          label={unavailable}
          className="absolute top-0 right-0"
          labelClassName="rounded-tr-xl"
        />
        <div className="flex w-full items-center gap-3 px-4 pt-4 pb-1.5">
          <div
            aria-label={iconName ?? t(($) => $['newKnowledge.cardType'])}
            title={iconName}
            className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-components-icon-bg-orange-dark-soft"
          >
            {iconName ? (
              <span aria-hidden className="system-md-semibold text-text-tertiary">
                {iconName.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span aria-hidden className="i-ri-book-open-line size-5 text-text-tertiary" />
            )}
          </div>
          <div className="min-w-0 flex-1 py-px pr-16">
            <h2 className="truncate system-md-semibold text-text-secondary">
              {knowledgeSpace.name}
            </h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-1 system-2xs-medium-uppercase text-text-disabled">
              <span className="truncate">{t(($) => $['newKnowledge.cardType'])}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{unavailable}</span>
            </div>
          </div>
        </div>
        <p className="line-clamp-2 w-full px-4 py-0.5 body-xs-regular text-text-tertiary">
          {knowledgeSpace.description || t(($) => $['newKnowledge.noDescription'])}
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
          <span className="shrink-0 text-text-disabled">
            {t(($) => $['newKnowledge.documentsUnavailable'])}
          </span>
          <span aria-hidden className="text-divider-deep">
            ·
          </span>
          <span className="shrink-0 text-text-disabled">
            {t(($) => $['newKnowledge.appsUnavailable'])}
          </span>
          <span className="ml-auto min-w-0 truncate text-right">
            {t(($) => $['newKnowledge.updated'], {
              date: formattedUpdatedAt,
            })}
          </span>
        </div>
      </article>
    </li>
  )
}
