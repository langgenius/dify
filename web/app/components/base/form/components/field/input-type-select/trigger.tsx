import type { FileTypeSelectOption } from './types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type TriggerProps = {
  option: FileTypeSelectOption | undefined
}

const Trigger = ({
  option,
}: TriggerProps) => {
  const { t } = useTranslation()

  if (!option)
    return <span className="grow p-1">{t('placeholder.select', { ns: 'common' })}</span>

  return (
    <span className="flex min-w-0 items-center gap-x-0.5">
      <option.Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
      <span className="min-w-0 grow truncate p-1">{option.label}</span>
      <span className="relative inline-flex h-5 shrink-0 items-center rounded-[5px] border border-divider-deep px-[5px] system-xs-medium leading-3 whitespace-nowrap text-text-tertiary">
        {option.type}
      </span>
    </span>
  )
}

export default React.memo(Trigger)
