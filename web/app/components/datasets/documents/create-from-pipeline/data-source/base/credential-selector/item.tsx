import { CredentialIcon } from '@/app/components/datasets/common/credential-icon'
import type { DataSourceCredential } from '@/types/pipeline'
import { RiCheckLine } from '@remixicon/react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type ItemProps = {
  credential: DataSourceCredential
  pluginName: string
  isSelected: boolean
  onCredentialChange: (credentialId: string) => void
}

const Item = ({
  credential,
  pluginName,
  isSelected,
  onCredentialChange,
}: ItemProps) => {
  const { t } = useTranslation()
  const { avatar_url, name } = credential

  const handleCredentialChange = useCallback(() => {
    onCredentialChange(credential.id)
  }, [credential.id, onCredentialChange])

  return (
    <div
      className='flex cursor-pointer items-center gap-x-2 rounded-lg p-2 hover:bg-state-base-hover'
      onClick={handleCredentialChange}
    >
      <CredentialIcon
        avatar_url={avatar_url}
        name={name}
        size={20}
      />
      <span className='system-sm-medium grow truncate text-text-secondary'>
        {t('datasetPipeline.credentialSelector.name', {
          credentialName: name,
          pluginName,
        })}
      </span>
      {
        isSelected && (
          <RiCheckLine className='size-4 shrink-0 text-text-accent' />
        )
      }
    </div>
  )
}

export default React.memo(Item)
