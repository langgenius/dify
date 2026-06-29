import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type TriggerProps = {
  tags: string[]
  canBindOrUnbindTags?: boolean
}

export const TagTrigger = ({
  tags,
  canBindOrUnbindTags = false,
}: TriggerProps) => {
  const { t } = useTranslation()
  const emptyTagLabel = canBindOrUnbindTags
    ? t('tag.addTag', { ns: 'common' })
    : t('tag.noTag', { ns: 'common' })

  return (
    <div
      className={cn(
        'flex w-full cursor-pointer items-center gap-1 overflow-hidden rounded-lg p-1 hover:bg-state-base-hover',
        !canBindOrUnbindTags && 'pointer-events-none opacity-50',
      )}
      role={tags.length ? 'list' : undefined}
    >
      {!tags.length
        ? (
            <div className="flex max-w-full min-w-0 items-center gap-x-0.5 rounded-[5px] border border-dashed border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75">
              <span aria-hidden="true" className="i-ri-price-tag-3-line size-3 shrink-0 text-text-quaternary" />
              <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
                {emptyTagLabel}
              </div>
            </div>
          )
        : (
            <>
              {
                tags.map((content) => {
                  return (
                    <div
                      key={content}
                      role="listitem"
                      className="flex max-w-30 min-w-0 shrink-0 items-center gap-x-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75"
                    >
                      <span aria-hidden="true" className="i-ri-price-tag-3-line size-3 shrink-0 text-text-quaternary" />
                      <div className="truncate system-2xs-medium text-text-tertiary">
                        {content}
                      </div>
                    </div>
                  )
                })
              }
            </>
          )}
    </div>
  )
}
