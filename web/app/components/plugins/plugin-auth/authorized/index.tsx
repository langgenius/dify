import type {
  OffsetOptions,
} from '@floating-ui/react'
import type { Placement } from '@langgenius/dify-ui/popover'
import type { Credential, PluginPayload } from '../types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
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
  renderTrigger?: (open?: boolean) => React.ReactNode
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  offset?: number | OffsetOptions
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
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const [isLocalOpen, setIsLocalOpen] = useState(false)
  const mergedIsOpen = isOpen ?? isLocalOpen
  const setMergedIsOpen = useCallback((open: boolean) => {
    if (onOpenChange)
      onOpenChange(open)

    setIsLocalOpen(open)
  }, [onOpenChange])
  const oAuthCredentials = credentials.filter(credential => credential.credential_type === CredentialTypeEnum.OAUTH2)
  const apiKeyCredentials = credentials.filter(credential => credential.credential_type === CredentialTypeEnum.API_KEY)
  const pendingOperationCredentialIdRef = useRef<string | null>(null)
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const { mutateAsync: deletePluginCredential } = useDeletePluginCredentialHook(pluginPayload)
  const openConfirm = useCallback((credentialId?: string) => {
    if (!canManageCredential)
      return

    setMergedIsOpen(false)
    if (credentialId)
      pendingOperationCredentialIdRef.current = credentialId

    setDeleteCredentialId(pendingOperationCredentialIdRef.current)
  }, [canManageCredential, setMergedIsOpen])
  const closeConfirm = useCallback(() => {
    setDeleteCredentialId(null)
    pendingOperationCredentialIdRef.current = null
  }, [])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((doing: boolean) => {
    doingActionRef.current = doing
    setDoingAction(doing)
  }, [])
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current || !canManageCredential)
      return
    if (!pendingOperationCredentialIdRef.current) {
      setDeleteCredentialId(null)
      return
    }
    try {
      handleSetDoingAction(true)
      await deletePluginCredential({ credential_id: pendingOperationCredentialIdRef.current })
      toast.success(t($ => $['api.actionSuccess'], { ns: 'common' }))
      onUpdate?.()
      setDeleteCredentialId(null)
      pendingOperationCredentialIdRef.current = null
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [canManageCredential, deletePluginCredential, onUpdate, t, handleSetDoingAction])
  const [editValues, setEditValues] = useState<Record<string, unknown> | null>(null)
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const handleEdit = useCallback((id: string, values: Record<string, unknown>) => {
    if (!canManageCredential)
      return

    setMergedIsOpen(false)
    pendingOperationCredentialIdRef.current = id
    setEditValues(values)
    setIsApiKeyModalOpen(true)
  }, [canManageCredential, setMergedIsOpen])
  const handleApiKeyModalOpenChange = useCallback((open: boolean) => {
    setIsApiKeyModalOpen(open)
    if (!open)
      pendingOperationCredentialIdRef.current = null
  }, [])
  // Lifted state for the "+ Add API Key" modal so it isn't unmounted when the
  // popover closes due to outside-click detection on the modal's portal.
  const [isAddApiKeyOpen, setIsAddApiKeyOpen] = useState(false)
  const handleAddApiKeyClick = useCallback(() => {
    if (!canCreateCredential)
      return

    setMergedIsOpen(false)
    setIsAddApiKeyOpen(true)
  }, [canCreateCredential, setMergedIsOpen])
  const handleRemove = useCallback(() => {
    if (!canManageCredential)
      return

    setDeleteCredentialId(pendingOperationCredentialIdRef.current)
  }, [canManageCredential])
  const { mutateAsync: setPluginDefaultCredential } = useSetPluginDefaultCredentialHook(pluginPayload)
  const handleSetDefault = useCallback(async (id: string) => {
    if (doingActionRef.current || !canUseCredential)
      return
    try {
      handleSetDoingAction(true)
      await setPluginDefaultCredential(id)
      toast.success(t($ => $['api.actionSuccess'], { ns: 'common' }))
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [canUseCredential, setPluginDefaultCredential, onUpdate, t, handleSetDoingAction])
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)
  const handleRename = useCallback(async (payload: {
    credential_id: string
    name: string
  }) => {
    if (doingActionRef.current || !canManageCredential)
      return
    try {
      handleSetDoingAction(true)
      await updatePluginCredential(payload)
      toast.success(t($ => $['api.actionSuccess'], { ns: 'common' }))
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [canManageCredential, updatePluginCredential, t, handleSetDoingAction, onUpdate])
  const unavailableCredentials = credentials.filter(credential => credential.not_allowed_to_use)
  const unavailableCredential = credentials.find(credential => credential.not_allowed_to_use && credential.is_default)
  const resolvedOffset = typeof offset === 'number' || typeof offset === 'function' ? undefined : offset
  const sideOffset = typeof offset === 'number' ? offset : resolvedOffset?.mainAxis ?? 0
  const alignOffset = typeof offset === 'number' ? 0 : resolvedOffset?.crossAxis ?? resolvedOffset?.alignmentAxis ?? 0
  const popupProps = triggerPopupSameWidth
    ? { style: { width: 'var(--anchor-width, auto)' } }
    : undefined

  return (
    <>
      <Popover
        open={mergedIsOpen}
        onOpenChange={setMergedIsOpen}
      >
        <PopoverTrigger
          render={(
            <div className={triggerPopupSameWidth ? 'w-full' : 'inline-block'}>
              {
                renderTrigger
                  ? renderTrigger(mergedIsOpen)
                  : (
                      <Button
                        className={cn(
                          'w-full',
                          mergedIsOpen && 'bg-components-button-secondary-bg-hover',
                        )}
                      >
                        <StatusDot className="mr-2" status={unavailableCredential ? 'disabled' : 'success'} />
                        {credentials.length}
&nbsp;
                        {
                          credentials.length > 1
                            ? t($ => $['auth.authorizations'], { ns: 'plugin' })
                            : t($ => $['auth.authorization'], { ns: 'plugin' })
                        }
                        {
                          !!unavailableCredentials.length && (
                            ` (${unavailableCredentials.length} ${t($ => $['auth.unavailable'], { ns: 'plugin' })})`
                          )
                        }
                        <span className="ml-0.5 i-ri-arrow-down-s-line size-4" />
                      </Button>
                    )
              }
            </div>
          )}
        />
        <PopoverContent
          placement={placement}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          popupProps={popupProps}
          popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
        >
          <div className={cn(
            'max-h-[360px] overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg',
            popupClassName,
          )}
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
                      'px-3 pt-1 pb-0.5 system-xs-medium text-text-tertiary',
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
                      'px-3 pt-1 pb-0.5 system-xs-medium text-text-tertiary',
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
                  <div className="h-px bg-divider-subtle"></div>
                  <div className="p-2">
                    <Authorize
                      pluginPayload={pluginPayload}
                      theme="secondary"
                      showDivider={false}
                      canOAuth={canOAuth}
                      canApiKey={canApiKey}
                      onUpdate={onUpdate}
                      onApiKeyClick={handleAddApiKeyClick}
                    />
                  </div>
                </>
              )
            }
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={!!deleteCredentialId} onOpenChange={open => !open && closeConfirm()}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t($ => $['list.delete.title'], { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t($ => $['operation.cancel'], { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={!canManageCredential || doingAction} onClick={handleConfirm}>
              {t($ => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      {
        !!editValues && (
          <ApiKeyModal
            open={isApiKeyModalOpen}
            onOpenChange={handleApiKeyModalOpenChange}
            pluginPayload={pluginPayload}
            editValues={editValues}
            onClose={() => handleApiKeyModalOpenChange(false)}
            onRemove={handleRemove}
            disabled={!canManageCredential || doingAction}
            onUpdate={onUpdate}
          />
        )
      }
      {
        isAddApiKeyOpen && (
          <ApiKeyModal
            open={isAddApiKeyOpen}
            onOpenChange={setIsAddApiKeyOpen}
            pluginPayload={pluginPayload}
            onClose={() => setIsAddApiKeyOpen(false)}
            disabled={!canCreateCredential || doingAction}
            onUpdate={onUpdate}
          />
        )
      }
    </>
  )
}

export default memo(Authorized)
