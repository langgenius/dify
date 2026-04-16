import type { Credential, PluginPayload } from '../types'
import type {
  PortalToFollowElemOptions,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import Indicator from '@/app/components/header/indicator'
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
  offset?: PortalToFollowElemOptions['offset']
  placement?: PortalToFollowElemOptions['placement']
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
  const [editValues, setEditValues] = useState<Record<string, any> | null>(null)
  const handleEdit = useCallback((id: string, values: Record<string, any>) => {
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

  return (
    <>
      <PortalToFollowElem
        open={mergedIsOpen}
        onOpenChange={setMergedIsOpen}
        placement={placement}
        offset={offset}
        triggerPopupSameWidth={triggerPopupSameWidth}
      >
        <PortalToFollowElemTrigger
          onClick={() => setMergedIsOpen(!mergedIsOpen)}
          asChild
        >
          {
            renderTrigger
              ? renderTrigger(mergedIsOpen)
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
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-100">
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
                  <div className="h-px bg-divider-subtle"></div>
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
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      <AlertDialog open={!!deleteCredentialId} onOpenChange={open => !open && closeConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('list.delete.title', { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={doingAction} onClick={handleConfirm}>
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
