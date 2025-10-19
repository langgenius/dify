import React from 'react'
import type { DataSourceCredential } from '@/types/pipeline'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { CredentialIcon } from '@/app/components/datasets/common/credential-icon'

type TriggerProps = {
  currentCredential: DataSourceCredential | undefined
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
    name = '',
  } = currentCredential || {}

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-x-2 rounded-md p-1 pr-2',
        isOpen ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
      )}
    >
      <CredentialIcon
        avatar_url={avatar_url}
        name={name}
        size={20}
      />
      <div className='flex grow items-center gap-x-1 overflow-hidden'>
        <span className='system-md-semibold grow truncate text-text-secondary'>
          {t('datasetPipeline.credentialSelector.name', {
            credentialName: name,
            pluginName,
          })}
        </span>
        <RiArrowDownSLine className='size-4 shrink-0 text-text-secondary' />
      </div>
    </div>
  )
}

export default React.memo(Trigger)
