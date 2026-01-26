import type { DataSourceCredential } from '@/types/pipeline'
import { RiArrowDownSLine } from '@remixicon/react'
import * as React from 'react'
import { CredentialIcon } from '@/app/components/datasets/common/credential-icon'
import { cn } from '@/utils/classnames'

type TriggerProps = {
  currentCredential: DataSourceCredential | undefined
  isOpen: boolean
}

const Trigger = ({
  currentCredential,
  isOpen,
}: TriggerProps) => {
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
        avatarUrl={avatar_url}
        name={name}
        size={20}
      />
      <div className="flex grow items-center gap-x-1 overflow-hidden">
        <span className="system-md-semibold grow truncate text-text-secondary">
          {name}
        </span>
        <RiArrowDownSLine className="size-4 shrink-0 text-text-secondary" />
      </div>
    </div>
  )
}

export default React.memo(Trigger)
