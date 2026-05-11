import type {
  DataSourceCredential,
} from './types'
import { cn } from '@langgenius/dify-ui/cn'
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
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'

type OperatorProps = {
  credentialItem: DataSourceCredential
  onAction: (action: string, credentialItem: DataSourceCredential) => void
  onRename?: () => void
}
const Operator = ({
  credentialItem,
  onAction,
  onRename,
}: OperatorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    type,
  } = credentialItem
  const handleAction = useCallback((action: string) => {
    setOpen(false)
    queueMicrotask(() => {
      if (action === 'rename') {
        onRename?.()
        return
      }
      onAction(action, credentialItem)
    })
  }, [credentialItem, onAction, onRename])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={(
          <ActionButton
            size="l"
            className={cn(open && 'bg-state-base-hover', 'focus-visible:ring-2 focus-visible:ring-state-accent-solid')}
            aria-label={t('operation.more', { ns: 'common' })}
          >
            <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
          </ActionButton>
        )}
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-[200px]">
        <DropdownMenuItem className="h-auto gap-2 py-2" onClick={() => handleAction('setDefault')}>
          <span aria-hidden className="i-ri-home-9-line h-4 w-4 text-text-tertiary" />
          <div className="system-sm-semibold text-text-secondary">{t('auth.setDefault', { ns: 'plugin' })}</div>
        </DropdownMenuItem>
        {type === CredentialTypeEnum.OAUTH2 && (
          <DropdownMenuItem className="h-auto gap-2 py-2" onClick={() => handleAction('rename')}>
            <span aria-hidden className="i-ri-edit-line h-4 w-4 text-text-tertiary" />
            <div className="system-sm-semibold text-text-secondary">{t('operation.rename', { ns: 'common' })}</div>
          </DropdownMenuItem>
        )}
        {type === CredentialTypeEnum.API_KEY && (
          <DropdownMenuItem className="h-auto gap-2 py-2" onClick={() => handleAction('edit')}>
            <span aria-hidden className="i-ri-equalizer-2-line h-4 w-4 text-text-tertiary" />
            <div className="system-sm-semibold text-text-secondary">{t('operation.edit', { ns: 'common' })}</div>
          </DropdownMenuItem>
        )}
        {type === CredentialTypeEnum.OAUTH2 && (
          <DropdownMenuItem className="h-auto gap-2 py-2" onClick={() => handleAction('change')}>
            <span aria-hidden className="i-ri-sticky-note-add-line h-4 w-4 text-text-tertiary" />
            <div className="mb-1 system-sm-semibold text-text-secondary">{t('dataSource.notion.changeAuthorizedPages', { ns: 'common' })}</div>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="h-auto gap-2 py-2" onClick={() => handleAction('delete')}>
          <span aria-hidden className="i-ri-delete-bin-line h-4 w-4" />
          <div className="system-sm-semibold">
            {t('operation.remove', { ns: 'common' })}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(Operator)
