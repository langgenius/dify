import type { Credential } from '../../declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
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
  const { t } = useTranslation()
  const showAction = useMemo(() => {
    return !(disableRename && disableEdit && disableDelete)
  }, [disableRename, disableEdit, disableDelete])
  const disableDeleteWhenSelected = useMemo(() => {
    return disableDeleteButShowAction && selectedCredentialId === credential.credential_id
  }, [disableDeleteButShowAction, selectedCredentialId, credential.credential_id])
  const isUnavailable = !!credential.not_allowed_to_use

  const Item = (
    <div
      key={credential.credential_id}
      className={cn(
        'group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : isUnavailable
            ? 'cursor-not-allowed'
            : onItemClick && 'cursor-pointer',
      )}
      onClick={() => {
        if (disabled || isUnavailable) return
        onItemClick?.(credential)
      }}
    >
      <div className="flex w-0 grow items-center gap-1.5">
        {showSelectedIcon && (
          <div className="size-4">
            {selectedCredentialId === credential.credential_id && (
              <span className="i-ri-check-line size-4 text-text-accent" />
            )}
          </div>
        )}
        <StatusDot className="shrink-0" size="small" status={isUnavailable ? 'error' : 'success'} />
        <div
          className="truncate system-md-regular text-text-secondary"
          title={credential.credential_name}
        >
          {credential.credential_name}
        </div>
      </div>
      {credential.from_enterprise && <Badge className="shrink-0">Enterprise</Badge>}
      {isUnavailable && (
        <div className="ml-2 shrink-0 pr-1 system-xs-medium text-text-destructive">
          {t(($) => $['modelProvider.card.unavailable'], { ns: 'common' })}
        </div>
      )}
      {showAction && !credential.from_enterprise && !isUnavailable && (
        <div className="ml-2 hidden shrink-0 items-center group-hover:flex">
          {!disableEdit && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit?.(credential)
                    }}
                  >
                    <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
                  </ActionButton>
                }
              />
              <TooltipContent>{t(($) => $['operation.edit'], { ns: 'common' })}</TooltipContent>
            </Tooltip>
          )}
          {!disableDelete && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ActionButton
                    className="hover:bg-transparent"
                    onClick={(e) => {
                      if (disabled || disableDeleteWhenSelected) return
                      e.stopPropagation()
                      onDelete?.(credential)
                    }}
                  >
                    <span
                      className={cn(
                        'i-ri-delete-bin-line size-4 text-text-tertiary',
                        !disableDeleteWhenSelected && 'hover:text-text-destructive',
                        disableDeleteWhenSelected && 'opacity-50',
                      )}
                    />
                  </ActionButton>
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
