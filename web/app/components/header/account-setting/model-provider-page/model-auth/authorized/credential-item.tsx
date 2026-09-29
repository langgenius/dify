import type { Credential } from '../../declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['common', 'plugin', 'modelProvider'])
  const showAction = useMemo(() => {
    return !(disableRename && disableEdit && disableDelete)
  }, [disableRename, disableEdit, disableDelete])
  const disableDeleteWhenSelected = useMemo(() => {
    return disableDeleteButShowAction && selectedCredentialId === credential.credential_id
  }, [disableDeleteButShowAction, selectedCredentialId, credential.credential_id])
  const isUnavailable = !!credential.not_allowed_to_use
  const canSelect = !!onItemClick && !isUnavailable

  const content = (
    <>
      <span className="flex w-0 grow items-center gap-1.5">
        {showSelectedIcon && (
          <span className="size-4">
            {selectedCredentialId === credential.credential_id && (
              <span className="i-ri-check-line size-4 text-text-accent" />
            )}
          </span>
        )}
        <StatusDot className="shrink-0" size="small" status={isUnavailable ? 'error' : 'success'} />
        <span
          className="truncate system-md-regular text-text-secondary"
          title={credential.credential_name}
        >
          {credential.credential_name}
        </span>
      </span>
      {isUnavailable && (
        <span className="ml-2 shrink-0 pr-1 system-xs-medium text-text-destructive">
          {t(($) => $['modelProvider.card.unavailable'], { ns: 'modelProvider' })}
        </span>
      )}
    </>
  )

  const Item = (
    <div
      key={credential.credential_id}
      className={cn(
        'group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover',
        disabled && 'opacity-50',
      )}
    >
      {canSelect ? (
        <button
          type="button"
          className="flex h-full min-w-0 grow cursor-pointer items-center rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
          disabled={disabled}
          aria-pressed={
            showSelectedIcon ? selectedCredentialId === credential.credential_id : undefined
          }
          onClick={() => onItemClick?.(credential)}
        >
          {content}
          {credential.from_enterprise && (
            <span className="badge badge-m shrink-0 px-1.25 py-0.5 system-2xs-medium">
              Enterprise
            </span>
          )}
        </button>
      ) : (
        <div className="flex min-w-0 grow items-center">{content}</div>
      )}
      {!canSelect && credential.from_enterprise && <Badge className="shrink-0">Enterprise</Badge>}
      {showAction && !credential.from_enterprise && !isUnavailable && (
        <div className="ml-2 flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {!disableEdit && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton
                    aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit?.(credential)
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="i-ri-equalizer-2-line size-4 text-text-tertiary"
                    />
                  </IconButton>
                }
              />
              <TooltipContent>{t(($) => $['operation.edit'], { ns: 'common' })}</TooltipContent>
            </Tooltip>
          )}
          {!disableDelete && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton
                    aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
                    className="hover:bg-transparent"
                    disabled={disabled || disableDeleteWhenSelected}
                    focusableWhenDisabled={!!disableDeleteWhenSelected && !disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete?.(credential)
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'i-ri-delete-bin-line size-4 text-text-tertiary',
                        !disableDeleteWhenSelected && 'hover:text-text-destructive',
                        disableDeleteWhenSelected && 'opacity-50',
                      )}
                    />
                  </IconButton>
                }
              />
              <TooltipContent>
                {disableDeleteWhenSelected
                  ? disableDeleteTip
                  : t(($) => $['operation.delete'], { ns: 'common' })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )

  if (isUnavailable) {
    return (
      <Tooltip>
        <TooltipTrigger render={Item} />
        <TooltipContent>
          {t(($) => $['auth.customCredentialUnavailable'], { ns: 'plugin' })}
        </TooltipContent>
      </Tooltip>
    )
  }
  return Item
}

export default memo(CredentialItem)
