import type { Credential, PluginPayload } from '../types'
import type { Placement } from '@/app/components/base/ui/placement'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import {
  isValidElement,
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { toast } from '@/app/components/base/ui/toast'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'
import Authorize from '../authorize'
import ApiKeyModal from '../authorize/api-key-modal'
import {
  useDeletePluginCredentialHook,
  useSetPluginDefaultCredentialHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { CredentialTypeEnum } from '../types'
import Item from './item'

type AuthorizedProps = {
  pluginPayload: PluginPayload
  credentials: Credential[]
  canOAuth?: boolean
  canApiKey?: boolean
  disabled?: boolean
  renderTrigger?: (open?: boolean) => React.ReactNode
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  offset?: number
  placement?: Placement
  triggerPopupSameWidth?: boolean
  popupClassName?: string
  disableSetDefault?: boolean
  onItemClick?: (id: string) => void
  extraAuthorizationItems?: Credential[]
  showItemSelectedIcon?: boolean
  selectedCredentialId?: string
  onUpdate?: () => void
  notAllowCustomCredential?: boolean
}
const Authorized = ({
  pluginPayload,
  credentials,
  canOAuth,
  canApiKey,
  disabled,
  renderTrigger,
  isOpen,
  onOpenChange,
  offset = 8,
  placement = 'bottom-start',
  triggerPopupSameWidth = true,
  popupClassName,
  disableSetDefault,
  onItemClick,
  extraAuthorizationItems,
  showItemSelectedIcon,
  selectedCredentialId,
  onUpdate,
  notAllowCustomCredential,
}: AuthorizedProps) => {
  const { t } = useTranslation()
  const [isLocalOpen, setIsLocalOpen] = useState(false)
  const mergedIsOpen = isOpen ?? isLocalOpen
  const setMergedIsOpen = useCallback((open: boolean) => {
    if (onOpenChange)
      onOpenChange(open)

    setIsLocalOpen(open)
  }, [onOpenChange])
  const oAuthCredentials = credentials.filter(credential => credential.credential_type === CredentialTypeEnum.OAUTH2)
  const apiKeyCredentials = credentials.filter(credential => credential.credential_type === CredentialTypeEnum.API_KEY)
  const pendingOperationCredentialId = useRef<string | null>(null)
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const { mutateAsync: deletePluginCredential } = useDeletePluginCredentialHook(pluginPayload)
  const openConfirm = useCallback((credentialId?: string) => {
    if (credentialId)
      pendingOperationCredentialId.current = credentialId

    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const closeConfirm = useCallback(() => {
    setDeleteCredentialId(null)
    pendingOperationCredentialId.current = null
  }, [])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((doing: boolean) => {
    doingActionRef.current = doing
    setDoingAction(doing)
  }, [])
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current)
      return
    if (!pendingOperationCredentialId.current) {
      setDeleteCredentialId(null)
      return
    }
    try {
      handleSetDoingAction(true)
      await deletePluginCredential({ credential_id: pendingOperationCredentialId.current })
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onUpdate?.()
      setDeleteCredentialId(null)
      pendingOperationCredentialId.current = null
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [deletePluginCredential, onUpdate, t, handleSetDoingAction])
  const [editValues, setEditValues] = useState<Record<string, unknown> | null>(null)
  const handleEdit = useCallback((id: string, values: Record<string, unknown>) => {
    pendingOperationCredentialId.current = id
    setEditValues(values)
  }, [])
  const handleRemove = useCallback(() => {
    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const { mutateAsync: setPluginDefaultCredential } = useSetPluginDefaultCredentialHook(pluginPayload)
  const handleSetDefault = useCallback(async (id: string) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await setPluginDefaultCredential(id)
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [setPluginDefaultCredential, onUpdate, t, handleSetDoingAction])
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)
  const handleRename = useCallback(async (payload: {
    credential_id: string
    name: string
  }) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await updatePluginCredential(payload)
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [updatePluginCredential, t, handleSetDoingAction, onUpdate])
  const unavailableCredentials = credentials.filter(credential => credential.not_allowed_to_use)
  const unavailableCredential = credentials.find(credential => credential.not_allowed_to_use && credential.is_default)
  const triggerElement = renderTrigger?.(mergedIsOpen)

  return (
    <>
      <Popover open={mergedIsOpen} onOpenChange={setMergedIsOpen}>
        <PopoverTrigger
          render={
            isValidElement(triggerElement)
              ? triggerElement
              : (
                  <Button
                    className={cn(
                      'w-full',
                      isOpen && 'bg-components-button-secondary-bg-hover',
                    )}
                  >
                    <Indicator className="mr-2" color={unavailableCredential ? 'gray' : 'green'} />
                    {credentials.length}
                    &nbsp;
                    {
                      credentials.length > 1
                        ? t('auth.authorizations', { ns: 'plugin' })
                        : t('auth.authorization', { ns: 'plugin' })
                    }
                    {
                      !!unavailableCredentials.length && (
                        ` (${unavailableCredentials.length} ${t('auth.unavailable', { ns: 'plugin' })})`
                      )
                    }
                    <RiArrowDownSLine className="ml-0.5 h-4 w-4" />
                  </Button>
                )
          }
        />
        <PopoverContent
          placement={placement}
          sideOffset={offset}
          popupProps={triggerPopupSameWidth ? { style: { width: 'var(--anchor-width, auto)' } } : undefined}
          popupClassName={cn(
            'overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg',
            popupClassName,
          )}
        >
          <div
            className="max-h-[360px]"
            data-plugin-auth-panel="true"
            onMouseLeave={() => setMergedIsOpen(false)}
          >
            <div className="py-1">
              {
                !!extraAuthorizationItems?.length && (
                  <div className="p-1">
                    {
                      extraAuthorizationItems.map(credential => (
                        <Item
                          key={credential.id}
                          credential={credential}
                          disabled={disabled}
                          onItemClick={onItemClick}
                          disableRename
                          disableEdit
                          disableDelete
                          disableSetDefault
                          showSelectedIcon={showItemSelectedIcon}
                          selectedCredentialId={selectedCredentialId}
                        />
                      ))
                    }
                  </div>
                )
              }
              {
                !!oAuthCredentials.length && (
                  <div className="p-1">
                    <div className={cn(
                      'px-3 pb-0.5 pt-1 text-text-tertiary system-xs-medium',
                      showItemSelectedIcon && 'pl-7',
                    )}
                    >
                      OAuth
                    </div>
                    {
                      oAuthCredentials.map(credential => (
                        <Item
                          key={credential.id}
                          credential={credential}
                          disabled={disabled}
                          disableEdit
                          onDelete={openConfirm}
                          onSetDefault={handleSetDefault}
                          onRename={handleRename}
                          disableSetDefault={disableSetDefault}
                          onItemClick={onItemClick}
                          showSelectedIcon={showItemSelectedIcon}
                          selectedCredentialId={selectedCredentialId}
                        />
                      ))
                    }
                  </div>
                )
              }
              {
                !!apiKeyCredentials.length && (
                  <div className="p-1">
                    <div className={cn(
                      'px-3 pb-0.5 pt-1 text-text-tertiary system-xs-medium',
                      showItemSelectedIcon && 'pl-7',
                    )}
                    >
                      API Keys
                    </div>
                    {
                      apiKeyCredentials.map(credential => (
                        <Item
                          key={credential.id}
                          credential={credential}
                          disabled={disabled}
                          onDelete={openConfirm}
                          onEdit={handleEdit}
                          onSetDefault={handleSetDefault}
                          disableSetDefault={disableSetDefault}
                          disableRename
                          onItemClick={onItemClick}
                          onRename={handleRename}
                          showSelectedIcon={showItemSelectedIcon}
                          selectedCredentialId={selectedCredentialId}
                        />
                      ))
                    }
                  </div>
                )
              }
            </div>
            {
              !notAllowCustomCredential && (
                <>
                  <div className="h-[1px] bg-divider-subtle"></div>
                  <div className="p-2">
                    <Authorize
                      pluginPayload={pluginPayload}
                      theme="secondary"
                      showDivider={false}
                      canOAuth={canOAuth}
                      canApiKey={canApiKey}
                      disabled={disabled}
                      onUpdate={onUpdate}
                    />
                  </div>
                </>
              )
            }
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog
        open={!!deleteCredentialId}
        onOpenChange={(open) => {
          if (!open)
            closeConfirm()
        }}
      >
        <AlertDialogContent className="w-[480px]">
          <div className="px-6 pb-4 pt-6">
            <AlertDialogTitle className="text-text-primary title-2xl-semi-bold">
              {t('list.delete.title', { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={doingAction} onClick={closeConfirm}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={doingAction} disabled={doingAction} onClick={handleConfirm}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      {
        !!editValues && (
          <ApiKeyModal
            pluginPayload={pluginPayload}
            editValues={editValues}
            onClose={() => {
              setEditValues(null)
              pendingOperationCredentialId.current = null
            }}
            onRemove={handleRemove}
            disabled={disabled || doingAction}
            onUpdate={onUpdate}
          />
        )
      }
    </>
  )
}

export default memo(Authorized)
