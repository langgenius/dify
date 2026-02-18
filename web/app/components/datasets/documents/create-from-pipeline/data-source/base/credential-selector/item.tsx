import type { DataSourceCredential } from '@/types/pipeline'
import { RiCheckLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { CredentialIcon } from '@/app/components/datasets/common/credential-icon'

type ItemProps = {
  credential: DataSourceCredential
  isSelected: boolean
  onCredentialChange: (credentialId: string) => void
}

const Item = ({
  credential,
  isSelected,
  onCredentialChange,
}: ItemProps) => {
  const { avatar_url, name } = credential

  const handleCredentialChange = useCallback(() => {
    onCredentialChange(credential.id)
  }, [credential.id, onCredentialChange])

  return (
    <div
      className="flex cursor-pointer items-center gap-x-2 rounded-lg p-2 hover:bg-state-base-hover"
      onClick={handleCredentialChange}
    >
      <CredentialIcon
        avatarUrl={avatar_url}
        name={name}
        size={20}
      />
      <span className="system-sm-medium grow truncate text-text-secondary">
        {name}
      </span>
      {
        isSelected && (
          <RiCheckLine className="size-4 shrink-0 text-text-accent" />
        )
      }
    </div>
  )
}

export default React.memo(Item)
