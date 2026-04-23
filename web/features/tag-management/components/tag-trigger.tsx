import { useTranslation } from 'react-i18next'

type TriggerProps = {
  tags: string[]
}

export const TagTrigger = ({
  tags,
}: TriggerProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex w-full cursor-pointer items-center gap-1 overflow-hidden rounded-lg p-1 hover:bg-state-base-hover">
      {!tags.length
        ? (
            <div className="flex max-w-full min-w-0 items-center gap-x-0.5 rounded-[5px] border border-dashed border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75">
              <span aria-hidden="true" className="i-ri-price-tag-3-line h-3 w-3 shrink-0 text-text-quaternary" />
              <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
                {t('tag.addTag', { ns: 'common' })}
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
                      className="flex max-w-30 min-w-0 shrink-0 items-center gap-x-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75"
                      data-testid={`tag-badge-${content}`}
                    >
                      <span aria-hidden="true" className="i-ri-price-tag-3-line h-3 w-3 shrink-0 text-text-quaternary" />
                      <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
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
