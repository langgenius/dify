import type { Credential } from '../types'
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'
import { CredentialTypeEnum } from '../types'

type ItemProps = {
  credential: Credential
  disabled?: boolean
  onDelete?: (id: string) => void
  onEdit?: (id: string, values: Record<string, any>) => void
  onSetDefault?: (id: string) => void
  onRename?: (payload: {
    credential_id: string
    name: string
  }) => void
  disableRename?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
  disableSetDefault?: boolean
  onItemClick?: (id: string) => void
  showSelectedIcon?: boolean
  selectedCredentialId?: string
}
const Item = ({
  credential,
  disabled,
  onDelete,
  onEdit,
  onSetDefault,
  onRename,
  disableRename,
  disableEdit,
  disableDelete,
  disableSetDefault,
  onItemClick,
  showSelectedIcon,
  selectedCredentialId,
}: ItemProps) => {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(credential.name)
  const isOAuth = credential.credential_type === CredentialTypeEnum.OAUTH2
  const showAction = useMemo(() => {
    return !(disableRename && disableEdit && disableDelete && disableSetDefault)
  }, [disableRename, disableEdit, disableDelete, disableSetDefault])

  const CredentialItem = (
    <div
      key={credential.id}
      className={cn(
        'group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover',
        renaming && 'bg-state-base-hover',
        (disabled || credential.not_allowed_to_use) && 'cursor-not-allowed opacity-50',
      )}
      onClick={() => {
        if (credential.not_allowed_to_use || disabled)
          return
        onItemClick?.(credential.id === '__workspace_default__' ? '' : credential.id)
      }}
    >
      {
        renaming && (
          <div className="flex w-full items-center space-x-1">
            <Input
              wrapperClassName="grow rounded-[6px]"
              className="h-6"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              placeholder={t('placeholder.input', { ns: 'common' })}
              onClick={e => e.stopPropagation()}
            />
            <Button
              size="small"
              variant="primary"
              onClick={(e) => {
                e.stopPropagation()
                onRename?.({
                  credential_id: credential.id,
                  name: renameValue,
                })
                setRenaming(false)
              }}
            >
              {t('operation.save', { ns: 'common' })}
            </Button>
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(false)
              }}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
        )
      }
      {
        !renaming && (
          <div className="flex w-0 grow items-center space-x-1.5">
            {
              showSelectedIcon && (
                <div className="h-4 w-4">
                  {
                    selectedCredentialId === credential.id && (
                      <RiCheckLine className="h-4 w-4 text-text-accent" />
                    )
                  }
                </div>
              )
            }
            <Indicator
              className="ml-2 mr-1.5 shrink-0"
              color={credential.not_allowed_to_use ? 'gray' : 'green'}
            />
            <div
              className="system-md-regular truncate text-text-secondary"
              title={credential.name}
            >
              {credential.name}
            </div>
            {
              credential.is_default && (
                <Badge className="shrink-0">
                  {t('auth.default', { ns: 'plugin' })}
                </Badge>
              )
            }
          </div>
        )
      }
      {
        credential.from_enterprise && (
          <Badge className="shrink-0">
            Enterprise
          </Badge>
        )
      }
      {
        showAction && !renaming && (
          <div className="ml-2 hidden shrink-0 items-center group-hover:flex">
            {
              !credential.is_default && !disableSetDefault && !credential.not_allowed_to_use && (
                <Button
                  size="small"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetDefault?.(credential.id)
                  }}
                >
                  {t('auth.setDefault', { ns: 'plugin' })}
                </Button>
              )
            }
            {
              !disableRename && !credential.from_enterprise && !credential.not_allowed_to_use && (
                <Tooltip popupContent={t('operation.rename', { ns: 'common' })}>
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenaming(true)
                      setRenameValue(credential.name)
                    }}
                  >
                    <RiEditLine className="h-4 w-4 text-text-tertiary" />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !isOAuth && !disableEdit && !credential.from_enterprise && !credential.not_allowed_to_use && (
                <Tooltip popupContent={t('operation.edit', { ns: 'common' })}>
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
                    <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !disableDelete && !credential.from_enterprise && (
                <Tooltip popupContent={t('operation.delete', { ns: 'common' })}>
                  <ActionButton
                    className="hover:bg-transparent"
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete?.(credential.id)
                    }}
                  >
                    <RiDeleteBinLine className="h-4 w-4 text-text-tertiary hover:text-text-destructive" />
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
        {CredentialItem}
      </Tooltip>
    )
  }

  return (
    CredentialItem
  )
}

export default memo(Item)
