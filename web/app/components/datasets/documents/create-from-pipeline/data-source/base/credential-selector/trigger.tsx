import React from 'react'
import type { DataSourceCredential } from '@/types/pipeline'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import cn from '@/utils/classnames'

type TriggerProps = {
  currentCredential: DataSourceCredential
  pluginName: string
  isOpen: boolean
}

const Trigger = ({
  currentCredential,
  pluginName,
  isOpen,
}: TriggerProps) => {
  const { t } = useTranslation()

  const {
    avatar_url,
    name,
  } = currentCredential

  return (
    <div className={cn(
      'flex cursor-pointer items-center gap-x-2 rounded-md p-1 pr-2',
      isOpen ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
    )}>
      <img src={avatar_url} className='size-5 shrink-0 rounded-md border border-divider-regular object-contain' />
      <div className='flex grow items-center gap-x-1'>
        <span className='system-md-semibold text-text-secondary'>
          {t('datasetPipeline.credentialSelector.name', {
            credentialName: name,
            pluginName,
          })}
        </span>
        <RiArrowDownSLine className='size-4 text-text-secondary' />
      </div>
    </div>
  )
}

export default React.memo(Trigger)
