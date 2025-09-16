import { ActionButton } from '@/app/components/base/action-button'
import Modal from '@/app/components/base/modal'
import { RiAddLine, RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { SupportedCreationMethods } from '../../../types'
import { useTriggerOAuthConfig, useTriggerProviderInfo } from '@/service/use-triggers'
import { usePluginStore } from '../../store'
import { useMemo } from 'react'
import { Button } from '@/app/components/base/button'
import { CreateTypeDropdown } from './type-dropdown'
import { useBoolean } from 'ahooks'

export const CreateModal = () => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow
      // onClose={onClose}
      className='!max-w-[520px] p-6'
      wrapperClassName='!z-[1002]'
    >
      <div className='flex items-center justify-between pb-3'>
        <h3 className='text-lg font-semibold text-text-primary'>
          {t('pluginTrigger.modal.oauth.title')}
        </h3>
        <ActionButton
        // onClick={onClose}
        >
          <RiCloseLine className='h-4 w-4' />
        </ActionButton>
      </div>
    </Modal>
  )
}

export enum CreateButtonType {
  FULL_BUTTON = 'full-button',
  ICON_BUTTON = 'icon-button',
}

type Props = {
  // onClick: (type?: SupportedCreationMethods | typeof DEFAULT_METHOD) => void
  className?: string
  buttonType?: CreateButtonType
}

export const DEFAULT_METHOD = 'default'

export const CreateSubscriptionButton = ({ className, buttonType = CreateButtonType.FULL_BUTTON }: Props) => {
  const { t } = useTranslation()

  const detail = usePluginStore(state => state.detail)
  const provider = `${detail?.plugin_id}/${detail?.declaration.name}`

  const { data: providerInfo } = useTriggerProviderInfo(provider, !!detail)
  const supportedMethods = providerInfo?.supported_creation_methods || []
  const { data: oauthConfig } = useTriggerOAuthConfig(provider, supportedMethods.includes(SupportedCreationMethods.OAUTH))

  const methodType = supportedMethods.length === 1 ? supportedMethods[0] : DEFAULT_METHOD

  const buttonTextMap = useMemo(() => {
    return {
      [SupportedCreationMethods.OAUTH]: t('pluginTrigger.subscription.createButton.oauth'),
      [SupportedCreationMethods.APIKEY]: t('pluginTrigger.subscription.createButton.apiKey'),
      [SupportedCreationMethods.MANUAL]: t('pluginTrigger.subscription.createButton.manual'),
      [DEFAULT_METHOD]: t('pluginTrigger.subscription.empty.button'),
    }
  }, [t])

  const [isShowCreateDropdown, {
    setTrue: showCreateDropdown,
    setFalse: hideCreateDropdown,
  }] = useBoolean(false)

  const onChooseCreateType = (type: SupportedCreationMethods) => {
    // setSelectedCreateType(type)
    hideCreateDropdown()
    // showCreateModal()
  }

  const onClickCreate = () => {
    if (methodType === DEFAULT_METHOD) {
      showCreateDropdown()
      return
    }
    onChooseCreateType(methodType)
  }

  if (!supportedMethods.length)
    return null

  return <div className='relative'>
    {
      buttonType === CreateButtonType.FULL_BUTTON ? (
        <Button
          variant='primary'
          size='medium'
          className={className}
          onClick={onClickCreate}
        >
          <RiAddLine className='mr-2 h-4 w-4' />
          {buttonTextMap[methodType]}
        </Button>
      ) : <ActionButton onClick={onClickCreate}>
        <RiAddLine className='h-4 w-4' />
      </ActionButton>
    }
    {isShowCreateDropdown && <CreateTypeDropdown
      onSelect={onChooseCreateType}
      onClose={hideCreateDropdown}
      supportedMethods={supportedMethods}
      oauthConfig={oauthConfig}
    />}
  </div>
}
