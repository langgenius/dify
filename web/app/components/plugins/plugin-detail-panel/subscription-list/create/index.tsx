import { ActionButton } from '@/app/components/base/action-button'
import { Button } from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { PortalSelect } from '@/app/components/base/select'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { useInitiateTriggerOAuth, useTriggerOAuthConfig, useTriggerProviderInfo } from '@/service/use-triggers'
import cn from '@/utils/classnames'
import { RiAddLine, RiCloseLine, RiEqualizer2Line } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SupportedCreationMethods } from '../../../types'
import { usePluginStore } from '../../store'
import { CommonCreateModal } from './common-modal'
import { OAuthClientSettingsModal } from './oauth-client'

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
  className?: string
  buttonType?: CreateButtonType
}

export const DEFAULT_METHOD = 'default'

/**
 * 区分创建订阅的授权方式有几种
 * 1. 只有一种授权方式
 *    - 按钮直接显示授权方式，点击按钮展示创建订阅弹窗
 * 2. 有多种授权方式
 *    - 下拉框显示授权方式，点击按钮展示下拉框，点击选项展示创建订阅弹窗
 * 有订阅与无订阅时，按钮形态不同
 * oauth 的授权类型：
 * - 是否配置 client_id 和 client_secret
 * - 未配置则点击按钮去配置
 * - 已配置则点击按钮去创建
 * - 固定展示设置按钮
 */
export const CreateSubscriptionButton = ({ buttonType = CreateButtonType.FULL_BUTTON }: Props) => {
  const { t } = useTranslation()
  const [selectedCreateType, setSelectedCreateType] = useState<SupportedCreationMethods | null>(null)

  const detail = usePluginStore(state => state.detail)
  const provider = `${detail?.plugin_id}/${detail?.declaration.name}`

  const { data: providerInfo } = useTriggerProviderInfo(provider, !!detail?.plugin_id && !!detail?.declaration.name)
  const supportedMethods = providerInfo?.supported_creation_methods || []
  const { data: oauthConfig } = useTriggerOAuthConfig(provider, supportedMethods.includes(SupportedCreationMethods.OAUTH))
  const { mutate: initiateOAuth } = useInitiateTriggerOAuth()

  const methodType = supportedMethods.length === 1 ? supportedMethods[0] : DEFAULT_METHOD

  const [isShowClientSettingsModal, {
    setTrue: showClientSettingsModal,
    setFalse: hideClientSettingsModal,
  }] = useBoolean(false)

  const buttonTextMap = useMemo(() => {
    return {
      [SupportedCreationMethods.OAUTH]: t('pluginTrigger.subscription.createButton.oauth'),
      [SupportedCreationMethods.APIKEY]: t('pluginTrigger.subscription.createButton.apiKey'),
      [SupportedCreationMethods.MANUAL]: t('pluginTrigger.subscription.createButton.manual'),
      [DEFAULT_METHOD]: t('pluginTrigger.subscription.empty.button'),
    }
  }, [t])

  const onClickClientSettings = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    showClientSettingsModal()
  }

  const allOptions = [
    {
      value: SupportedCreationMethods.OAUTH,
      name: t('pluginTrigger.subscription.addType.options.oauth.title'),
      extra: <ActionButton onClick={onClickClientSettings}><RiEqualizer2Line className='h-4 w-4 text-text-tertiary' /></ActionButton>,
      show: supportedMethods.includes(SupportedCreationMethods.OAUTH),
    },
    {
      value: SupportedCreationMethods.APIKEY,
      name: t('pluginTrigger.subscription.addType.options.apiKey.title'),
      show: supportedMethods.includes(SupportedCreationMethods.APIKEY),
    },
    {
      value: SupportedCreationMethods.MANUAL,
      name: t('pluginTrigger.subscription.addType.options.manual.description'), // 使用 description 作为标题
      tooltip: <Tooltip popupContent={t('pluginTrigger.subscription.addType.options.manual.tip')} />,
      show: supportedMethods.includes(SupportedCreationMethods.MANUAL),
    },
  ]

  const onChooseCreateType = (type: SupportedCreationMethods) => {
    if (type === SupportedCreationMethods.OAUTH) {
      if (oauthConfig?.configured) {
        initiateOAuth(provider, {
          onSuccess: (response) => {
            openOAuthPopup(response.authorization_url, (callbackData) => {
              if (callbackData) {
                Toast.notify({
                  type: 'success',
                  message: t('pluginTrigger.modal.oauth.authorized'),
                })
                setSelectedCreateType(SupportedCreationMethods.OAUTH)
              }
            })
          },
          onError: (error: any) => {
            Toast.notify({
              type: 'error',
              message: error?.message || t('pluginTrigger.modal.errors.authFailed'),
            })
          },
        })
      }
      else {
        showClientSettingsModal()
      }
    }
    else {
      setSelectedCreateType(type)
    }
  }

  const onClickCreate = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (methodType === DEFAULT_METHOD)
      return

    e.stopPropagation()
    e.preventDefault()
    onChooseCreateType(methodType)
  }

  if (!supportedMethods.length)
    return null

  return <>
    <PortalSelect
      readonly={methodType !== DEFAULT_METHOD}
      renderTrigger={() => {
        return buttonType === CreateButtonType.FULL_BUTTON ? (
          <Button
            variant='primary'
            size='medium'
            className='w-full'
            onClick={onClickCreate}
          >
            <RiAddLine className='mr-2 h-4 w-4' />
            {buttonTextMap[methodType]}
            {methodType === SupportedCreationMethods.OAUTH
              && <ActionButton onClick={onClickClientSettings}>
                <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
              </ActionButton>
            }
          </Button>
        ) : <ActionButton onClick={onClickCreate}>
          <RiAddLine className='h-4 w-4' />
        </ActionButton>
      }}
      triggerClassName='h-8'
      popupClassName={cn('z-[1000]')}
      popupInnerClassName={cn('w-[354px]')}
      value={methodType}
      items={allOptions.filter(option => option.show)}
      onSelect={item => onChooseCreateType(item.value as any)}
    />
    {selectedCreateType && (
      <CommonCreateModal
        createType={selectedCreateType}
        onClose={() => setSelectedCreateType(null)}
      />
    )}
    {isShowClientSettingsModal && (
      <OAuthClientSettingsModal
        oauthConfig={oauthConfig}
        onClose={hideClientSettingsModal}
      />
    )}
  </>
}
