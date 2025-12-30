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
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
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
        <PortalToFollowElemContent className="z-[100]">
          <div className={cn(
            'w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]',
            popupClassName,
          )}
          >
            {
              popupTitle && (
                <div className="system-xs-medium px-3 pb-0.5 pt-[10px] text-text-tertiary">
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
                        <div className="h-[1px] bg-divider-subtle"></div>
                      )
                    }
                  </Fragment>
                ))
              }
            </div>
            <div className="h-[1px] bg-divider-subtle"></div>
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
                  className="system-xs-medium flex h-[40px] cursor-pointer items-center px-3 text-text-accent-light-mode-only"
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
      {
        deleteCredentialId && (
          <Confirm
            isShow
            title={t('modelProvider.confirmDelete', { ns: 'common' })}
            isDisabled={doingAction}
            onCancel={closeConfirmDelete}
            onConfirm={handleConfirmDelete}
          />
        )
      }
    </>
  )
}

export default memo(Authorized)
