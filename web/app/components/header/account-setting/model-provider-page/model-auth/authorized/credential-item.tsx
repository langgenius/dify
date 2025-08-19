import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import Indicator from '@/app/components/header/indicator'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import type { Credential } from '../../declarations'
import Badge from '@/app/components/base/badge'

type CredentialItemProps = {
  credential: Credential
  disabled?: boolean
  onDelete?: (credential: Credential) => void
  onEdit?: (credential?: Credential) => void
  onItemClick?: (credential: Credential) => void
  disableRename?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
  showSelectedIcon?: boolean
  selectedCredentialId?: string
}
const CredentialItem = ({
  credential,
  disabled,
  onDelete,
  onEdit,
  onItemClick,
  disableRename,
  disableEdit,
  disableDelete,
  showSelectedIcon,
  selectedCredentialId,
}: CredentialItemProps) => {
  const { t } = useTranslation()
  const showAction = useMemo(() => {
    return !(disableRename && disableEdit && disableDelete)
  }, [disableRename, disableEdit, disableDelete])

  return (
    <div
      key={credential.credential_id}
      className={cn(
        'group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover',
      )}
      onClick={() => {
        onItemClick?.(credential)
      }}
    >
      <div className='flex w-0 grow items-center space-x-1.5'>
        {
          showSelectedIcon && (
            <div className='h-4 w-4'>
              {
                selectedCredentialId === credential.credential_id && (
                  <RiCheckLine className='h-4 w-4 text-text-accent' />
                )
              }
            </div>
          )
        }
        <Indicator className='ml-2 mr-1.5 shrink-0' />
        <div
          className='system-md-regular truncate text-text-secondary'
          title={credential.credential_name}
        >
          {credential.credential_name}
        </div>
      </div>
      {
        credential.from_enterprise && (
          <Badge className='shrink-0'>
            Enterprise
          </Badge>
        )
      }
      {
        showAction && (
          <div className='ml-2 hidden shrink-0 items-center group-hover:flex'>
            {
              !disableEdit && (
                <Tooltip popupContent={t('common.operation.edit')}>
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit?.(credential)
                    }}
                  >
                    <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !disableDelete && (
                <Tooltip popupContent={t('common.operation.delete')}>
                  <ActionButton
                    className='hover:bg-transparent'
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete?.(credential)
                    }}
                  >
                    <RiDeleteBinLine className='h-4 w-4 text-text-tertiary hover:text-text-destructive' />
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

export default memo(CredentialItem)
