import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  RiAddLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type {
  PortalToFollowElemOptions,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import Confirm from '@/app/components/base/confirm'
import type {
  ConfigurationMethodEnum,
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelProvider,
} from '../../declarations'
import { useAuth } from '../hooks'
import AuthorizedItem from './authorized-item'

type AuthorizedProps = {
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  isModelCredential?: boolean
  items: {
    title?: string
    model?: CustomModel
    credentials: Credential[]
  }[]
  selectedCredential?: Credential
  disabled?: boolean
  renderTrigger?: (open?: boolean) => React.ReactNode
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  offset?: PortalToFollowElemOptions['offset']
  placement?: PortalToFollowElemOptions['placement']
  triggerPopupSameWidth?: boolean
  popupClassName?: string
  showItemSelectedIcon?: boolean
  onUpdate?: () => void
  onItemClick?: (credential: Credential, model?: CustomModel) => void
  enableAddModelCredential?: boolean
  bottomAddModelCredentialText?: string
}
const Authorized = ({
  provider,
  configurationMethod,
  currentCustomConfigurationModelFixedFields,
  items,
  isModelCredential,
  selectedCredential,
  disabled,
  renderTrigger,
  isOpen,
  onOpenChange,
  offset = 8,
  placement = 'bottom-end',
  triggerPopupSameWidth = false,
  popupClassName,
  showItemSelectedIcon,
  onUpdate,
  onItemClick,
  enableAddModelCredential,
  bottomAddModelCredentialText,
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
    openConfirmDelete,
    closeConfirmDelete,
    doingAction,
    handleActiveCredential,
    handleConfirmDelete,
    deleteCredentialId,
    handleOpenModal,
  } = useAuth(provider, configurationMethod, currentCustomConfigurationModelFixedFields, isModelCredential, onUpdate)

  const handleEdit = useCallback((credential?: Credential, model?: CustomModel) => {
    handleOpenModal(credential, model)
    setMergedIsOpen(false)
  }, [handleOpenModal, setMergedIsOpen])

  const handleItemClick = useCallback((credential: Credential, model?: CustomModel) => {
    if (onItemClick)
      onItemClick(credential, model)
    else
      handleActiveCredential(credential, model)

    setMergedIsOpen(false)
  }, [handleActiveCredential, onItemClick, setMergedIsOpen])
  const notAllowCustomCredential = provider.allow_custom_token === false

  const Trigger = useMemo(() => {
    const Item = (
      <Button
        className='grow'
        size='small'
      >
        <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
        {t('common.operation.config')}
      </Button>
    )
    return Item
  }, [t])

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
            setMergedIsOpen(!mergedIsOpen)
          }}
          asChild
        >
          {
            renderTrigger
              ? renderTrigger(mergedIsOpen)
              : Trigger
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[100]'>
          <div className={cn(
            'w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg',
            popupClassName,
          )}>
            <div className='max-h-[304px] overflow-y-auto'>
              {
                items.map((item, index) => (
                  <AuthorizedItem
                    key={index}
                    title={item.title}
                    model={item.model}
                    credentials={item.credentials}
                    disabled={disabled}
                    onDelete={openConfirmDelete}
                    onEdit={handleEdit}
                    showItemSelectedIcon={showItemSelectedIcon}
                    selectedCredentialId={selectedCredential?.credential_id}
                    onItemClick={handleItemClick}
                    enableAddModelCredential={enableAddModelCredential}
                    notAllowCustomCredential={notAllowCustomCredential}
                  />
                ))
              }
            </div>
            <div className='h-[1px] bg-divider-subtle'></div>
            {
              isModelCredential && !notAllowCustomCredential && (
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
                  className='system-xs-medium flex h-[30px] cursor-pointer items-center px-3 text-text-accent-light-mode-only'
                >
                  <RiAddLine className='mr-1 h-4 w-4' />
                  {bottomAddModelCredentialText ?? t('common.modelProvider.auth.addModelCredential')}
                </div>
              )
            }
            {
              !isModelCredential && !notAllowCustomCredential && (
                <div className='p-2'>
                  <Button
                    onClick={() => handleEdit()}
                    className='w-full'
                  >
                    {t('common.modelProvider.auth.addApiKey')}
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
            title={t('common.modelProvider.confirmDelete')}
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
