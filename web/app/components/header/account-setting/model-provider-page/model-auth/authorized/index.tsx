import {
  memo,
  useCallback,
  useState,
} from 'react'
import {
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
  items: {
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
  onItemClick?: (id: string) => void
  showItemSelectedIcon?: boolean
  onUpdate?: () => void
  disableSetDefault?: boolean
}
const Authorized = ({
  provider,
  configurationMethod,
  currentCustomConfigurationModelFixedFields,
  items,
  selectedCredential,
  disabled,
  renderTrigger,
  isOpen,
  onOpenChange,
  offset = 8,
  placement = 'bottom-end',
  triggerPopupSameWidth = false,
  popupClassName,
  onItemClick,
  showItemSelectedIcon,
  onUpdate,
  disableSetDefault,
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
  } = useAuth(provider, configurationMethod, currentCustomConfigurationModelFixedFields, onUpdate)

  const handleEdit = useCallback((model?: CustomModel, credential?: Credential) => {
    handleOpenModal(model, credential)
    setMergedIsOpen(false)
  }, [handleOpenModal, setMergedIsOpen])

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
                  className='grow'
                  size='small'
                >
                  <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
                  {t('common.operation.config')}
                </Button>
              )
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
                    model={item.model}
                    credentials={item.credentials}
                    disabled={disabled}
                    onDelete={openConfirmDelete}
                    onEdit={handleEdit}
                    onSetDefault={handleActiveCredential}
                    onItemClick={onItemClick}
                    showItemSelectedIcon={showItemSelectedIcon}
                    selectedCredentialId={selectedCredential?.credential_id}
                    disableSetDefault={disableSetDefault}
                  />
                ))
              }
            </div>
            <div className='h-[1px] bg-divider-subtle'></div>
            <div className='p-2'>
              <Button
                onClick={() => handleOpenModal()}
                className='w-full'
              >
                add api key
              </Button>
            </div>
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
