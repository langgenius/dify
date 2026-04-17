import type {
  ConfigurationMethodEnum,
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelModalModeEnum,
  ModelProvider,
} from '../../declarations'
import type {
  PortalToFollowElemOptions,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiAddLine,
} from '@remixicon/react'
import {
  Fragment,
  memo,
  useCallback,
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
import { useAuth } from '../hooks'
import AuthorizedItem from './authorized-item'

type AuthorizedProps = {
  provider: ModelProvider
  configurationMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  authParams?: {
    isModelCredential?: boolean
    onUpdate?: (newPayload?: any, formValues?: Record<string, any>) => void
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
  offset?: PortalToFollowElemOptions['offset']
  placement?: PortalToFollowElemOptions['placement']
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
    handleOpenModal(credential, model)
    setMergedIsOpen(false)
  }, [handleOpenModal, setMergedIsOpen])

  const handleItemClick = useCallback((credential: Credential, model?: CustomModel) => {
    if (disableItemClick)
      return

    if (onItemClick)
      onItemClick(credential, model)
    else
      handleActiveCredential(credential, model)

    setMergedIsOpen(false)
  }, [handleActiveCredential, onItemClick, setMergedIsOpen, disableItemClick])
  const notAllowCustomCredential = provider.allow_custom_token === false

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
          onClick={() => {
            if (triggerOnlyOpenModal) {
              handleOpenModal()
              return
            }

            setMergedIsOpen(!mergedIsOpen)
          }}
          asChild
        >
          {renderTrigger(mergedIsOpen)}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-1002">
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
                items.map((item, index) => (
                  <Fragment key={index}>
                    <AuthorizedItem
                      provider={provider}
                      title={item.title}
                      model={item.model}
                      credentials={item.credentials}
                      disabled={disabled}
                      onDelete={openConfirmDelete}
                      disableDeleteButShowAction={disableDeleteButShowAction}
                      disableDeleteTip={disableDeleteTip}
                      onEdit={handleEdit}
                      showItemSelectedIcon={showItemSelectedIcon}
                      selectedCredentialId={item.selectedCredential?.credential_id}
                      onItemClick={handleItemClick}
                      showModelTitle={showModelTitle}
                    />
                    {
                      index !== items.length - 1 && (
                        <div className="h-px bg-divider-subtle"></div>
                      )
                    }
                  </Fragment>
                ))
              }
            </div>
            <div className="h-px bg-divider-subtle"></div>
            {
              isModelCredential && !notAllowCustomCredential && !hideAddAction && (
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
                  <RiAddLine className="mr-1 h-4 w-4" />
                  {t('modelProvider.auth.addModelCredential', { ns: 'common' })}
                </div>
              )
            }
            {
              !isModelCredential && !notAllowCustomCredential && !hideAddAction && (
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
        </PortalToFollowElemContent>
      </PortalToFollowElem>
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
