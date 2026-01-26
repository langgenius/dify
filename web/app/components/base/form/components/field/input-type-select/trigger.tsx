import type { FileTypeSelectOption } from './types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { cn } from '@/utils/classnames'

type TriggerProps = {
  option: FileTypeSelectOption | undefined
  open: boolean
}

const Trigger = ({
  option,
  open,
}: TriggerProps) => {
  const { t } = useTranslation()

  return (
    <>
      {option
        ? (
            <>
              <option.Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
              <span className="grow p-1">{option.label}</span>
              <div className="pr-0.5">
                <Badge text={option.type} uppercase={false} />
              </div>
            </>
          )
        : (
            <span className="grow p-1">{t('placeholder.select', { ns: 'common' })}</span>
          )}
      <span className={`i-ri-arrow-down-sline ${cn(
        'h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary',
        open && 'text-text-secondary',
      )}`}
      />
    </>
  )
}

export default React.memo(Trigger)
