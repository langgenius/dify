import type { Credential } from '../../declarations'
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'

type CredentialItemProps = {
  credential: Credential
  disabled?: boolean
  onDelete?: (credential: Credential) => void
  onEdit?: (credential?: Credential) => void
  onItemClick?: (credential: Credential) => void
  disableRename?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
  disableDeleteButShowAction?: boolean
  disableDeleteTip?: string
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
  disableDeleteButShowAction,
  disableDeleteTip,
  showSelectedIcon,
  selectedCredentialId,
}: CredentialItemProps) => {
  const { t } = useTranslation()
  const showAction = useMemo(() => {
    return !(disableRename && disableEdit && disableDelete)
  }, [disableRename, disableEdit, disableDelete])
  const disableDeleteWhenSelected = useMemo(() => {
    return disableDeleteButShowAction && selectedCredentialId === credential.credential_id
  }, [disableDeleteButShowAction, selectedCredentialId, credential.credential_id])

  const Item = (
    <div
      key={credential.credential_id}
      className={cn(
        'group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover',
        (disabled || credential.not_allowed_to_use) && 'cursor-not-allowed opacity-50',
      )}
      onClick={() => {
        if (disabled || credential.not_allowed_to_use)
          return
        onItemClick?.(credential)
      }}
    >
      <div className="flex w-0 grow items-center space-x-1.5">
        {
          showSelectedIcon && (
            <div className="h-4 w-4">
              {
                selectedCredentialId === credential.credential_id && (
                  <RiCheckLine className="h-4 w-4 text-text-accent" />
                )
              }
            </div>
          )
        }
        <Indicator className="ml-2 mr-1.5 shrink-0" />
        <div
          className="system-md-regular truncate text-text-secondary"
          title={credential.credential_name}
        >
          {credential.credential_name}
        </div>
      </div>
      {
        credential.from_enterprise && (
          <Badge className="shrink-0">
            Enterprise
          </Badge>
        )
      }
      {
        showAction && !credential.from_enterprise && (
          <div className="ml-2 hidden shrink-0 items-center group-hover:flex">
            {
              !disableEdit && !credential.not_allowed_to_use && (
                <Tooltip popupContent={t('operation.edit', { ns: 'common' })}>
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit?.(credential)
                    }}
                  >
                    <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !disableDelete && (
                <Tooltip popupContent={disableDeleteWhenSelected ? disableDeleteTip : t('operation.delete', { ns: 'common' })}>
                  <ActionButton
                    className="hover:bg-transparent"
                    onClick={(e) => {
                      if (disabled || disableDeleteWhenSelected)
                        return
                      e.stopPropagation()
                      onDelete?.(credential)
                    }}
                  >
                    <RiDeleteBinLine className={cn(
                      'h-4 w-4 text-text-tertiary',
                      !disableDeleteWhenSelected && 'hover:text-text-destructive',
                      disableDeleteWhenSelected && 'opacity-50',
                    )}
                    />
                  </ActionButton>
                </Tooltip>
              )
            }
          </div>
        )
      }
    </div>
  )

  if (credential.not_allowed_to_use) {
    return (
      <Tooltip popupContent={t('auth.customCredentialUnavailable', { ns: 'plugin' })}>
        {Item}
      </Tooltip>
    )
  }
  return Item
}

export default memo(CredentialItem)
