import type { DatasourceCredentialResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { Ref } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'

type OperatorProps = {
  credentialItem: DatasourceCredentialResponse
  onAction: (action: string, credentialItem: DatasourceCredentialResponse) => void
  onRename?: () => void
  triggerRef?: Ref<HTMLButtonElement>
  canUseCredential?: boolean
  canManageCredential?: boolean
}
const Operator = ({
  credentialItem,
  onAction,
  onRename,
  triggerRef,
  canUseCredential = false,
  canManageCredential = false,
}: OperatorProps) => {
  const { t } = useTranslation(['common', 'plugin'])
  const { type } = credentialItem
  const handleAction = useCallback(
    (action: string, allowed: boolean) => {
      if (!allowed) return

      queueMicrotask(() => {
        if (action === 'rename') {
          onRename?.()
          return
        }
        onAction(action, credentialItem)
      })
    },
    [credentialItem, onAction, onRename],
  )

  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            ref={triggerRef}
            size="lg"
            aria-label={`${t(($) => $['operation.more'], { ns: 'common' })} ${credentialItem.name}`}
            className="data-popup-open:bg-state-base-hover"
          >
            <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
          </IconButton>
        }
      />
      <MenuContent align="end" className="min-w-50">
        <MenuItem
          disabled={!canUseCredential}
          className="h-auto gap-2 py-2"
          onClick={() => handleAction('setDefault', canUseCredential)}
        >
          <span aria-hidden className="i-ri-home-9-line size-4 text-text-tertiary" />
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['auth.setDefault'], { ns: 'plugin' })}
          </div>
        </MenuItem>
        {type === CredentialTypeEnum.OAUTH2 && (
          <MenuItem
            disabled={!canManageCredential}
            className="h-auto gap-2 py-2"
            onClick={() => handleAction('rename', canManageCredential)}
          >
            <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
            <div className="system-sm-semibold text-text-secondary">
              {t(($) => $['operation.rename'], { ns: 'common' })}
            </div>
          </MenuItem>
        )}
        {type === CredentialTypeEnum.API_KEY && (
          <MenuItem
            disabled={!canManageCredential}
            className="h-auto gap-2 py-2"
            onClick={() => handleAction('edit', canManageCredential)}
          >
            <span aria-hidden className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            <div className="system-sm-semibold text-text-secondary">
              {t(($) => $['operation.edit'], { ns: 'common' })}
            </div>
          </MenuItem>
        )}
        {type === CredentialTypeEnum.OAUTH2 && (
          <MenuItem
            disabled={!canManageCredential}
            className="h-auto gap-2 py-2"
            onClick={() => handleAction('change', canManageCredential)}
          >
            <span aria-hidden className="i-ri-sticky-note-add-line size-4 text-text-tertiary" />
            <div className="mb-1 system-sm-semibold text-text-secondary">
              {t(($) => $['dataSource.notion.changeAuthorizedPages'], { ns: 'common' })}
            </div>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem
          disabled={!canManageCredential}
          variant="destructive"
          className="h-auto gap-2 py-2"
          onClick={() => handleAction('delete', canManageCredential)}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
          <div className="system-sm-semibold">
            {t(($) => $['operation.remove'], { ns: 'common' })}
          </div>
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

export default memo(Operator)
