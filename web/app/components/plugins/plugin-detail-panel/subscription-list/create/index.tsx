import type { Option } from '@/app/components/base/select/custom'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { RiAddLine, RiEqualizer2Line } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionButton, ActionButtonState } from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import { Button } from '@/app/components/base/button'
import CustomSelect from '@/app/components/base/select/custom'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { useInitiateTriggerOAuth, useTriggerOAuthConfig, useTriggerProviderInfo } from '@/service/use-triggers'
import { cn } from '@/utils/classnames'
import { SupportedCreationMethods } from '../../../types'
import { usePluginStore } from '../../store'
import { useSubscriptionList } from '../use-subscription-list'
import { CommonCreateModal } from './common-modal'
import { OAuthClientSettingsModal } from './oauth-client'

export enum CreateButtonType {
  FULL_BUTTON = 'full-button',
  ICON_BUTTON = 'icon-button',
}

type Props = {
  className?: string
  buttonType?: CreateButtonType
  shape?: 'square' | 'circle'
}

const MAX_COUNT = 10

export const DEFAULT_METHOD = 'default'

export const CreateSubscriptionButton = ({ buttonType = CreateButtonType.FULL_BUTTON, shape = 'square' }: Props) => {
  const { t } = useTranslation()
  const { subscriptions } = useSubscriptionList()
  const subscriptionCount = subscriptions?.length || 0
  const [selectedCreateInfo, setSelectedCreateInfo] = useState<{ type: SupportedCreationMethods, builder?: TriggerSubscriptionBuilder } | null>(null)

  const detail = usePluginStore(state => state.detail)

  const { data: providerInfo } = useTriggerProviderInfo(detail?.provider || '')
  const supportedMethods = providerInfo?.supported_creation_methods || []
  const { data: oauthConfig, refetch: refetchOAuthConfig } = useTriggerOAuthConfig(detail?.provider || '', supportedMethods.includes(SupportedCreationMethods.OAUTH))
  const { mutate: initiateOAuth } = useInitiateTriggerOAuth()

  const methodType = supportedMethods.length === 1 ? supportedMethods[0] : DEFAULT_METHOD

  const [isShowClientSettingsModal, {
    setTrue: showClientSettingsModal,
    setFalse: hideClientSettingsModal,
  }] = useBoolean(false)

  const buttonTextMap = useMemo(() => {
    return {
      [SupportedCreationMethods.OAUTH]: t('subscription.createButton.oauth', { ns: 'pluginTrigger' }),
      [SupportedCreationMethods.APIKEY]: t('subscription.createButton.apiKey', { ns: 'pluginTrigger' }),
      [SupportedCreationMethods.MANUAL]: t('subscription.createButton.manual', { ns: 'pluginTrigger' }),
      [DEFAULT_METHOD]: t('subscription.empty.button', { ns: 'pluginTrigger' }),
    }
  }, [t])

  const onClickClientSettings = (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    showClientSettingsModal()
  }

  const allOptions = useMemo(() => {
    const showCustomBadge = oauthConfig?.custom_enabled && oauthConfig?.custom_configured

    return [
      {
        value: SupportedCreationMethods.OAUTH,
        label: t('subscription.addType.options.oauth.title', { ns: 'pluginTrigger' }),
        tag: !showCustomBadge
          ? null
          : (
              <Badge className="ml-1 mr-0.5">
                {t('auth.custom', { ns: 'plugin' })}
              </Badge>
            ),
        extra: (
          <Tooltip popupContent={t('subscription.addType.options.oauth.clientSettings', { ns: 'pluginTrigger' })}>
            <ActionButton onClick={onClickClientSettings}>
              <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
            </ActionButton>
          </Tooltip>
        ),
        show: supportedMethods.includes(SupportedCreationMethods.OAUTH),
      },
      {
        value: SupportedCreationMethods.APIKEY,
        label: t('subscription.addType.options.apikey.title', { ns: 'pluginTrigger' }),
        show: supportedMethods.includes(SupportedCreationMethods.APIKEY),
      },
      {
        value: SupportedCreationMethods.MANUAL,
        label: t('subscription.addType.options.manual.description', { ns: 'pluginTrigger' }),
        extra: <Tooltip popupContent={t('subscription.addType.options.manual.tip', { ns: 'pluginTrigger' })} />,
        show: supportedMethods.includes(SupportedCreationMethods.MANUAL),
      },
    ]
  }, [t, oauthConfig, supportedMethods, methodType])

  const onChooseCreateType = async (type: SupportedCreationMethods) => {
    if (type === SupportedCreationMethods.OAUTH) {
      if (oauthConfig?.configured) {
        initiateOAuth(detail?.provider || '', {
          onSuccess: (response) => {
            openOAuthPopup(response.authorization_url, (callbackData) => {
              if (callbackData) {
                Toast.notify({
                  type: 'success',
                  message: t('modal.oauth.authorization.authSuccess', { ns: 'pluginTrigger' }),
                })
                setSelectedCreateInfo({ type: SupportedCreationMethods.OAUTH, builder: response.subscription_builder })
              }
            })
          },
          onError: () => {
            Toast.notify({
              type: 'error',
              message: t('modal.oauth.authorization.authFailed', { ns: 'pluginTrigger' }),
            })
          },
        })
      }
      else {
        showClientSettingsModal()
      }
    }
    else {
      setSelectedCreateInfo({ type })
    }
  }

  const onClickCreate = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (subscriptionCount >= MAX_COUNT) {
      e.stopPropagation()
      return
    }

    if (methodType === DEFAULT_METHOD || (methodType === SupportedCreationMethods.OAUTH && supportedMethods.length === 1))
      return

    e.stopPropagation()
    e.preventDefault()
    onChooseCreateType(methodType)
  }

  if (!supportedMethods.length)
    return null

  return (
    <>
      <CustomSelect<Option & { show: boolean, extra?: React.ReactNode, tag?: React.ReactNode }>
        options={allOptions.filter(option => option.show)}
        value={methodType}
        onChange={value => onChooseCreateType(value as any)}
        containerProps={{
          open: (methodType === DEFAULT_METHOD || (methodType === SupportedCreationMethods.OAUTH && supportedMethods.length === 1)) ? undefined : false,
          placement: 'bottom-start',
          offset: 4,
          triggerPopupSameWidth: buttonType === CreateButtonType.FULL_BUTTON,
        }}
        triggerProps={{
          className: cn('h-8 bg-transparent px-0 hover:bg-transparent', methodType !== DEFAULT_METHOD && supportedMethods.length > 1 && 'pointer-events-none', buttonType === CreateButtonType.FULL_BUTTON && 'grow'),
        }}
        popupProps={{
          wrapperClassName: 'z-[1000]',
        }}
        CustomTrigger={() => {
          return buttonType === CreateButtonType.FULL_BUTTON
            ? (
                <Button
                  variant="primary"
                  size="medium"
                  className="flex w-full items-center justify-between px-0"
                  onClick={onClickCreate}
                >
                  <div className="flex flex-1 items-center justify-center">
                    <RiAddLine className="mr-2 size-4" />
                    {buttonTextMap[methodType]}
                    {methodType === SupportedCreationMethods.OAUTH && oauthConfig?.custom_enabled && oauthConfig?.custom_configured && (
                      <Badge
                        className="ml-1 mr-0.5 border-text-primary-on-surface bg-components-badge-bg-dimm text-text-primary-on-surface"
                      >
                        {t('auth.custom', { ns: 'plugin' })}
                      </Badge>
                    )}
                  </div>
                  {methodType === SupportedCreationMethods.OAUTH
                    && (
                      <div className="ml-auto flex items-center">
                        <div className="h-4 w-px bg-text-primary-on-surface opacity-15" />
                        <Tooltip popupContent={t('subscription.addType.options.oauth.clientSettings', { ns: 'pluginTrigger' })}>
                          <div onClick={onClickClientSettings} className="p-2">
                            <RiEqualizer2Line className="size-4 text-components-button-primary-text" />
                          </div>
                        </Tooltip>
                      </div>
                    )}
                </Button>
              )
            : (
                <Tooltip
                  popupContent={subscriptionCount >= MAX_COUNT ? t('subscription.maxCount', { ns: 'pluginTrigger', num: MAX_COUNT }) : t(`subscription.addType.options.${methodType.toLowerCase() as Lowercase<SupportedCreationMethods>}.description`, { ns: 'pluginTrigger' })}
                  disabled={!(supportedMethods?.length === 1 || subscriptionCount >= MAX_COUNT)}
                >
                  <ActionButton
                    onClick={onClickCreate}
                    className={cn(
                      'float-right',
                      shape === 'circle' && '!rounded-full border-[0.5px] border-components-button-secondary-border-hover bg-components-button-secondary-bg-hover text-components-button-secondary-accent-text shadow-xs hover:border-components-button-secondary-border-disabled hover:bg-components-button-secondary-bg-disabled hover:text-components-button-secondary-accent-text-disabled',
                    )}
                    state={subscriptionCount >= MAX_COUNT ? ActionButtonState.Disabled : ActionButtonState.Default}
                  >
                    <RiAddLine className="size-4" />
                  </ActionButton>
                </Tooltip>
              )
        }}
        CustomOption={option => (
          <>
            <div className="mr-8 flex grow items-center gap-1 truncate px-1">
              {option.label}
              {option.tag}
            </div>
            {option.extra}
          </>
        )}
      />
      {selectedCreateInfo && (
        <CommonCreateModal
          createType={selectedCreateInfo.type}
          builder={selectedCreateInfo.builder}
          onClose={() => setSelectedCreateInfo(null)}
        />
      )}
      {isShowClientSettingsModal && (
        <OAuthClientSettingsModal
          oauthConfig={oauthConfig}
          onClose={() => {
            hideClientSettingsModal()
            refetchOAuthConfig()
          }}
          showOAuthCreateModal={builder => setSelectedCreateInfo({ type: SupportedCreationMethods.OAUTH, builder })}
        />
      )}
    </>
  )
}
