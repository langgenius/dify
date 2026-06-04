import type { Credential } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
  RiInformationLine,
} from '@remixicon/react'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import Input from '@/app/components/base/input'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { CredentialTypeEnum } from '../types'

type ItemProps = {
  credential: Credential
  disabled?: boolean
  onDelete?: (id: string) => void
  onEdit?: (id: string, values: Record<string, unknown>) => void
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
  const isPersonal = credential.visibility === 'only_me'
  const userProfile = useAppContextWithSelector(state => state.userProfile)
  // Borrowed-from-teammate: the backend explicitly flagged this row as another member's
  // only_me credential, returned only because the current node still references it.
  // Fallback heuristic (created_by mismatch on a selected row) is kept for backends
  // that don't yet emit the flag.
  const isSelected = showSelectedIcon && selectedCredentialId === credential.id
  const isConfiguredByOther
    = !!credential.created_by && !!userProfile?.id && credential.created_by !== userProfile.id
  const isBorrowed
    = !!credential.from_other_member || (isSelected && isConfiguredByOther && isPersonal)
  const showSwitchAwayHint = isBorrowed
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
              wrapperClassName="grow rounded-md"
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
                <div className="size-4">
                  {
                    selectedCredentialId === credential.id && (
                      <RiCheckLine className="size-4 text-text-accent" />
                    )
                  }
                </div>
              )
            }
            <StatusDot
              className="mr-1.5 ml-2 shrink-0"
              status={credential.not_allowed_to_use ? 'disabled' : 'success'}
            />
            <div
              className="truncate system-md-regular text-text-secondary"
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
        showSwitchAwayHint && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <div className="ml-2 flex shrink-0 cursor-help items-center text-text-tertiary">
                  <RiInformationLine className="size-4" />
                </div>
              )}
            />
            <TooltipContent>
              {t('auth.onlyAtCreationHintTooltip', { ns: 'plugin' })}
            </TooltipContent>
          </Tooltip>
        )
      }
      {
        !showSwitchAwayHint && credential.from_enterprise && (
          <Badge className="shrink-0">
            {t('auth.enterprise', { ns: 'plugin' })}
          </Badge>
        )
      }
      {
        showAction && !renaming && (
          <div className="ml-2 hidden shrink-0 items-center group-hover:flex">
            {
              !credential.is_default && !disableSetDefault && !credential.not_allowed_to_use && !isBorrowed && (
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
              !disableRename && !credential.from_enterprise && !credential.not_allowed_to_use && !isBorrowed && (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <ActionButton
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenaming(true)
                          setRenameValue(credential.name)
                        }}
                      >
                        <RiEditLine className="size-4 text-text-tertiary" />
                      </ActionButton>
                    )}
                  />
                  <TooltipContent>
                    {t('operation.rename', { ns: 'common' })}
                  </TooltipContent>
                </Tooltip>
              )
            }
            {
              !isOAuth && !disableEdit && !credential.from_enterprise && !credential.not_allowed_to_use && !isBorrowed && (
                <Tooltip>
                  <TooltipTrigger
                    render={(
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
                        <RiEqualizer2Line className="size-4 text-text-tertiary" />
                      </ActionButton>
                    )}
                  />
                  <TooltipContent>
                    {t('operation.edit', { ns: 'common' })}
                  </TooltipContent>
                </Tooltip>
              )
            }
            {
              !disableDelete && !credential.from_enterprise && !isBorrowed && (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <ActionButton
                        className="hover:bg-transparent"
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete?.(credential.id)
                        }}
                      >
                        <RiDeleteBinLine className="size-4 text-text-tertiary hover:text-text-destructive" />
                      </ActionButton>
                    )}
                  />
                  <TooltipContent>
                    {t('operation.delete', { ns: 'common' })}
                  </TooltipContent>
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
      <Tooltip>
        <TooltipTrigger render={CredentialItem} />
        <TooltipContent>
          {t('auth.customCredentialUnavailable', { ns: 'plugin' })}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    CredentialItem
  )
}

export default memo(Item)
