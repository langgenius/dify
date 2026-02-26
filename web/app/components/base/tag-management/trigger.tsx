import * as React from 'react'
import { useTranslation } from 'react-i18next'

type TriggerProps = {
  tags: string[]
}

const Trigger = ({
  tags,
}: TriggerProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex w-full cursor-pointer items-center gap-1 overflow-hidden rounded-lg p-1 hover:bg-state-base-hover">
      {!tags.length
        ? (
            <div className="flex items-center gap-x-0.5 rounded-[5px] border border-dashed border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]">
              <span className="i-ri-price-tag-3-line h-3 w-3 shrink-0 text-text-quaternary" />
              <div className="text-nowrap text-text-tertiary system-2xs-medium-uppercase">
                {t('tag.addTag', { ns: 'common' })}
              </div>
            </div>
          )
        : (
            <>
              {
                tags.map((content, index) => {
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-x-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]"
                      data-testid={`tag-badge-${index}`}
                    >
                      <span className="i-ri-price-tag-3-line h-3 w-3 shrink-0 text-text-quaternary" />
                      <div className="text-nowrap text-text-tertiary system-2xs-medium-uppercase">
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

export default React.memo(Trigger)
