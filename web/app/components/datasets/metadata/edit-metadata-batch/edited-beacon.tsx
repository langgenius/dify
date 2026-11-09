'use client'
import type { FC } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  fieldId?: string
  onReset: () => void
}>

const EditedBeacon: FC<Props> = ({ fieldId, onReset }) => {
  const { t } = useTranslation(['common'])
  const resetId = useId()

  return (
    <>
      <span id={resetId} className="sr-only">
        {t(($) => $['operation.reset'], { ns: 'common' })}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <IconButton
              variant="ghost-accent"
              aria-labelledby={[resetId, fieldId].filter(Boolean).join(' ')}
              onClick={onReset}
            >
              <span className="i-ri-reset-left-line size-3" aria-hidden="true" />
            </IconButton>
          }
        />
        <TooltipContent>{t(($) => $['operation.reset'], { ns: 'common' })}</TooltipContent>
      </Tooltip>
    </>
  )
}
export default React.memo(EditedBeacon)
