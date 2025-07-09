import {
  memo,
  useMemo,
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
  disableRename?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
  disableSetDefault?: boolean
  onItemClick?: (id: string) => void
}
const Item = ({
  credential,
  disabled,
  onDelete,
  onEdit,
  onSetDefault,
  disableRename,
  disableEdit,
  disableDelete,
  disableSetDefault,
  onItemClick,
}: ItemProps) => {
  const isOAuth = credential.credential_type === CredentialTypeEnum.OAUTH2
  const showAction = useMemo(() => {
    return !(disableRename && disableEdit && disableDelete && disableSetDefault)
  }, [disableRename, disableEdit, disableDelete, disableSetDefault])

  return (
    <div
      key={credential.id}
      className='group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover'
      onClick={() => onItemClick?.(credential.id)}
    >
      <div className='flex w-0 grow items-center space-x-1.5 pl-2'>
        <Indicator className='mr-1.5 shrink-0' />
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
      {
        showAction && (
          <div className='ml-2 hidden shrink-0 items-center group-hover:flex'>
            {
              !credential.is_default && !disableSetDefault && (
                <Button
                  size='small'
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetDefault?.(credential.id)
                  }}
                >
                  Set as default
                </Button>
              )
            }
            {
              isOAuth && !disableRename && (
                <Tooltip popupContent='rename'>
                  <ActionButton>
                    <RiEditLine className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !isOAuth && !disableEdit && (
                <Tooltip popupContent='edit'>
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit?.(
                        credential.id,
                        {
                          ...credential.credentials,
                          __name__: credential.name,
                          __credential_id__: credential.id,
                        },
                      )
                    }}
                  >
                    <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !disableDelete && (
                <Tooltip popupContent='delete'>
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete?.(credential.id)
                    }}
                  >
                    <RiDeleteBinLine className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                </Tooltip>
              )
            }
          </div>
        )
      }
    </div>
  )
}

export default memo(Item)
