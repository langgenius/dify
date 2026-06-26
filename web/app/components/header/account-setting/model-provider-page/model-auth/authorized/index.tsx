import type { Placement } from '@langgenius/dify-ui/popover'
import type { MouseEvent } from 'react'
import type {
  ConfigurationMethodEnum,
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelModalModeEnum,
  ModelProvider,
} from '../../declarations'
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
import {
  Fragment,
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'
import { useAuth } from '../hooks'
import AuthorizedItem from './authorized-item'

type PopoverOffsetOptions = {
  mainAxis?: number
  crossAxis?: number
  alignmentAxis?: number
}

type AuthorizedProps = {
  provider: ModelProvider
  configurationMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  authParams?: {
    isModelCredential?: boolean
    onUpdate?: (newPayload?: Record<string, unknown>, formValues?: Record<string, unknown>) => void
    onRemove?: (credentialId: string) => void
    mode?: ModelModalModeEnum
  }
  items: {
    title?: string
    model?: CustomModel
    selectedCredential?: Credential
    credentials: Credential[]
  }[]
  disabled?: boolean
  renderTrigger: (open?: boolean) => React.ReactNode
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  offset?: number | PopoverOffsetOptions
  placement?: Placement
  triggerPopupSameWidth?: boolean
  popupClassName?: string
  showItemSelectedIcon?: boolean
  onItemClick?: (credential: Credential, model?: CustomModel) => void
  enableAddModelCredential?: boolean
  triggerOnlyOpenModal?: boolean
  hideAddAction?: boolean
  disableItemClick?: boolean
  popupTitle?: string
  showModelTitle?: boolean
  disableDeleteButShowAction?: boolean
  disableDeleteTip?: string
}
const Authorized = ({
  provider,
  configurationMethod,
  currentCustomConfigurationModelFixedFields,
  items,
  authParams,
  disabled,
  renderTrigger,
  isOpen,
  onOpenChange,
  offset = 8,
  placement = 'bottom-end',
  triggerPopupSameWidth = false,
  popupClassName,
  showItemSelectedIcon,
  onItemClick,
  triggerOnlyOpenModal,
  hideAddAction,
  disableItemClick,
  popupTitle,
  showModelTitle,
  disableDeleteButShowAction,
  disableDeleteTip,
}: AuthorizedProps) => {
  const { t } = useTranslation()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canUseCredential = hasPermission(workspacePermissionKeys, ['credential.use', 'credential.manage'])
  const canManageCredential = hasPermission(workspacePermissionKeys, 'credential.manage')
  const [isLocalOpen, setIsLocalOpen] = useState(false)
  const mergedIsOpen = isOpen ?? isLocalOpen
  const setMergedIsOpen = useCallback((open: boolean) => {
    if (onOpenChange)
      onOpenChange(open)

    setIsLocalOpen(open)
  }, [onOpenChange])
  const {
    isModelCredential,
    onUpdate,
    onRemove,
    mode,
  } = authParams || {}
  const {
    openConfirmDelete,
    closeConfirmDelete,
    doingAction,
    handleActiveCredential,
    handleConfirmDelete,
    deleteCredentialId,
    handleOpenModal,
  } = useAuth(
    provider,
    configurationMethod,
    currentCustomConfigurationModelFixedFields,
    {
      isModelCredential,
      onUpdate,
      onRemove,
      mode,
    },
  )

  const handleEdit = useCallback((credential?: Credential, model?: CustomModel) => {
    if (!canManageCredential)
      return

    setMergedIsOpen(false)
    handleOpenModal(credential, model)
  }, [canManageCredential, handleOpenModal, setMergedIsOpen])
  const handleDelete = useCallback((credential?: Credential, model?: CustomModel) => {
    if (!canManageCredential)
      return

    setMergedIsOpen(false)
    openConfirmDelete(credential, model)
  }, [canManageCredential, openConfirmDelete, setMergedIsOpen])

  const handleItemClick = useCallback((credential: Credential, model?: CustomModel) => {
    if (!canUseCredential)
      return

    if (disableItemClick)
      return

    if (onItemClick)
      onItemClick(credential, model)
    else
      handleActiveCredential(credential, model)

    setMergedIsOpen(false)
  }, [canUseCredential, handleActiveCredential, onItemClick, setMergedIsOpen, disableItemClick])
  const notAllowCustomCredential = provider.allow_custom_token === false
  const resolvedOffset = typeof offset === 'number' ? undefined : offset
  const sideOffset = typeof offset === 'number' ? offset : resolvedOffset?.mainAxis ?? 0
  const alignOffset = typeof offset === 'number' ? 0 : resolvedOffset?.crossAxis ?? resolvedOffset?.alignmentAxis ?? 0
  const popupProps = triggerPopupSameWidth
    ? { style: { width: 'var(--anchor-width, auto)' } }
    : undefined
  const handleTriggerClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!triggerOnlyOpenModal)
      return

    event.preventDefault()
    if (!canManageCredential)
      return

    handleOpenModal()
  }, [canManageCredential, handleOpenModal, triggerOnlyOpenModal])

  return (
    <>
      <Popover
        open={mergedIsOpen}
        onOpenChange={setMergedIsOpen}
      >
        <PopoverTrigger
          nativeButton={false}
          render={<div className={triggerPopupSameWidth ? 'w-full' : 'inline-block'}>{renderTrigger(mergedIsOpen)}</div>}
          onClick={handleTriggerClick}
        />
        <PopoverContent
          placement={placement}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          popupProps={popupProps}
          popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
        >
          <div className={cn(
            'w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]',
            popupClassName,
          )}
          >
            {
              popupTitle && (
                <div className="px-3 pt-[10px] pb-0.5 system-xs-medium text-text-tertiary">
                  {popupTitle}
                </div>
              )
            }
            <div className="max-h-[304px] overflow-y-auto">
              {
                items.map(item => (
                  <Fragment key={item.model?.model ?? item.title ?? item.credentials.map(credential => credential.credential_id).join('-')}>
                    <AuthorizedItem
                      provider={provider}
                      title={item.title}
                      model={item.model}
                      credentials={item.credentials}
                      disabled={disabled || !canUseCredential}
                      disableEdit={!canManageCredential}
                      disableDelete={!canManageCredential}
                      onDelete={handleDelete}
                      disableDeleteButShowAction={disableDeleteButShowAction}
                      disableDeleteTip={disableDeleteTip}
                      onEdit={handleEdit}
                      showItemSelectedIcon={showItemSelectedIcon}
                      selectedCredentialId={item.selectedCredential?.credential_id}
                      onItemClick={handleItemClick}
                      showModelTitle={showModelTitle}
                    />
                    {
                      item !== items[items.length - 1] && (
                        <div className="h-px bg-divider-subtle"></div>
                      )
                    }
                  </Fragment>
                ))
              }
            </div>
            <div className="h-px bg-divider-subtle"></div>
            {
              isModelCredential && !notAllowCustomCredential && !hideAddAction && canManageCredential && (
                <div
                  onClick={() => handleEdit(
                    undefined,
                    currentCustomConfigurationModelFixedFields
                      ? {
                          model: currentCustomConfigurationModelFixedFields.__model_name,
                          model_type: currentCustomConfigurationModelFixedFields.__model_type,
                        }
                      : undefined,
                  )}
                  className="flex h-[40px] cursor-pointer items-center px-3 system-xs-medium text-text-accent-light-mode-only"
                >
                  <span className="mr-1 i-ri-add-line size-4" />
                  {t('modelProvider.auth.addModelCredential', { ns: 'common' })}
                </div>
              )
            }
            {
              !isModelCredential && !notAllowCustomCredential && !hideAddAction && canManageCredential && (
                <div className="p-2">
                  <Button
                    onClick={() => handleEdit()}
                    className="w-full"
                  >
                    {t('modelProvider.auth.addApiKey', { ns: 'common' })}
                  </Button>
                </div>
              )
            }
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={!!deleteCredentialId} onOpenChange={open => !open && closeConfirmDelete()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('modelProvider.confirmDelete', { ns: 'common' })}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={doingAction} onClick={handleConfirmDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default memo(Authorized)
