import { RiPriceTag3Line } from '@remixicon/react'
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
              <RiPriceTag3Line className="h-3 w-3 shrink-0 text-text-quaternary" />
              <div className="system-2xs-medium-uppercase text-nowrap text-text-tertiary">
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
                    >
                      <RiPriceTag3Line className="h-3 w-3 shrink-0 text-text-quaternary" />
                      <div className="system-2xs-medium-uppercase text-nowrap text-text-tertiary">
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
