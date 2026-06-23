import type {
  DataSourceCredential,
} from './types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'

type OperatorProps = {
  credentialItem: DataSourceCredential
  onAction: (action: string, credentialItem: DataSourceCredential) => void
  onRename?: () => void
  canUseCredential?: boolean
  canManageCredential?: boolean
}
const Operator = ({
  credentialItem,
  onAction,
  onRename,
  canUseCredential = false,
  canManageCredential = false,
}: OperatorProps) => {
  const { t } = useTranslation()
  const {
    type,
  } = credentialItem
  const handleAction = useCallback((action: string, allowed: boolean) => {
    if (!allowed)
      return

    queueMicrotask(() => {
      if (action === 'rename') {
        onRename?.()
        return
      }
      onAction(action, credentialItem)
    })
  }, [credentialItem, onAction, onRename])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <ActionButton
            size="l"
            className="focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
            aria-label={t('operation.more', { ns: 'common' })}
          >
            <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
          </ActionButton>
        )}
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-[200px]">
        <DropdownMenuItem disabled={!canUseCredential} className="h-auto gap-2 py-2" onClick={() => handleAction('setDefault', canUseCredential)}>
          <span aria-hidden className="i-ri-home-9-line size-4 text-text-tertiary" />
          <div className="system-sm-semibold text-text-secondary">{t('auth.setDefault', { ns: 'plugin' })}</div>
        </DropdownMenuItem>
        {type === CredentialTypeEnum.OAUTH2 && (
          <DropdownMenuItem disabled={!canManageCredential} className="h-auto gap-2 py-2" onClick={() => handleAction('rename', canManageCredential)}>
            <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
            <div className="system-sm-semibold text-text-secondary">{t('operation.rename', { ns: 'common' })}</div>
          </DropdownMenuItem>
        )}
        {type === CredentialTypeEnum.API_KEY && (
          <DropdownMenuItem disabled={!canManageCredential} className="h-auto gap-2 py-2" onClick={() => handleAction('edit', canManageCredential)}>
            <span aria-hidden className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            <div className="system-sm-semibold text-text-secondary">{t('operation.edit', { ns: 'common' })}</div>
          </DropdownMenuItem>
        )}
        {type === CredentialTypeEnum.OAUTH2 && (
          <DropdownMenuItem disabled={!canManageCredential} className="h-auto gap-2 py-2" onClick={() => handleAction('change', canManageCredential)}>
            <span aria-hidden className="i-ri-sticky-note-add-line size-4 text-text-tertiary" />
            <div className="mb-1 system-sm-semibold text-text-secondary">{t('dataSource.notion.changeAuthorizedPages', { ns: 'common' })}</div>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canManageCredential} variant="destructive" className="h-auto gap-2 py-2" onClick={() => handleAction('delete', canManageCredential)}>
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
          <div className="system-sm-semibold">
            {t('operation.remove', { ns: 'common' })}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(Operator)
