'use client'
import type { FC } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiResetLeftLine } from '@remixicon/react'
import { useHover } from 'ahooks'
import * as React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  onReset: () => void
}

const EditedBeacon: FC<Props> = ({
  onReset,
}) => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const isHovering = useHover(ref)

  return (
    <div ref={ref} className="size-4 cursor-pointer">
      {isHovering
        ? (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <button
                    type="button"
                    aria-label={t('operation.reset', { ns: 'common' })}
                    className="flex size-4 items-center justify-center rounded-full border-none bg-text-accent-secondary p-0"
                    onClick={onReset}
                  >
                    <RiResetLeftLine className="size-[10px] text-text-primary-on-surface" aria-hidden="true" />
                  </button>
                )}
              />
              <TooltipContent>
                {t('operation.reset', { ns: 'common' })}
              </TooltipContent>
            </Tooltip>
          )
        : (
            <div className="flex size-4 items-center justify-center">
              <div className="size-1 rounded-full bg-text-accent-secondary"></div>
            </div>
          )}
    </div>
  )
}
export default React.memo(EditedBeacon)
