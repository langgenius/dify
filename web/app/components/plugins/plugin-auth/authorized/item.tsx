import {
  memo,
} from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import Indicator from '@/app/components/header/indicator'
import Badge from '@/app/components/base/badge'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'
import type { Credential } from '../types'
import { CredentialTypeEnum } from '../types'

type ItemProps = {
  credential: Credential
  disabled?: boolean
  onDelete?: (id: string) => void
  onEdit?: (id: string, values: Record<string, any>) => void
  onSetDefault?: (id: string) => void
}
const Item = ({
  credential,
  disabled,
  onDelete,
  onEdit,
  onSetDefault,
}: ItemProps) => {
  const isOAuth = credential.credential_type === CredentialTypeEnum.OAUTH2

  return (
    <div
      key={credential.id}
      className='group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover'
    >
      <div className='flex grow items-center space-x-1.5 pl-2'>
        <Indicator className='mr-1.5' />
        <div
          className='system-md-regular truncate text-text-secondary'
          title={credential.name}
        >
          {credential.name}
        </div>
        {
          credential.is_default && (
            <Badge>
              Default
            </Badge>
          )
        }
      </div>
      <div className='ml-2 hidden shrink-0 items-center group-hover:flex'>
        <Button
          size='small'
          disabled={disabled}
          onClick={() => onSetDefault?.(credential.id)}
        >
          Set as default
        </Button>
        {
          isOAuth && (
            <Tooltip popupContent='rename'>
              <ActionButton>
                <RiEditLine className='h-4 w-4 text-text-tertiary' />
              </ActionButton>
            </Tooltip>
          )
        }
        {
          !isOAuth && (
            <Tooltip popupContent='edit'>
              <ActionButton
                disabled={disabled}
                onClick={() => onEdit?.(credential.id, credential.credentials)}
              >
                <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
              </ActionButton>
            </Tooltip>
          )
        }
        <Tooltip popupContent='delete'>
          <ActionButton
            disabled={disabled}
            onClick={() => onDelete?.(credential.id)}
          >
            <RiDeleteBinLine className='h-4 w-4 text-text-tertiary' />
          </ActionButton>
        </Tooltip>
      </div>
    </div>
  )
}

export default memo(Item)
