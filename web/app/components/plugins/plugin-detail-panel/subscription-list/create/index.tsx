import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectTrigger } from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useBoolean } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionButton, ActionButtonState } from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { useInitiateTriggerOAuth, useTriggerOAuthConfig, useTriggerProviderInfo } from '@/service/use-triggers'
import { SupportedCreationMethods } from '../../../types'
import { usePluginStore } from '../../store'
import { useSubscriptionList } from '../use-subscription-list'
import { CommonCreateModal } from './common-modal'
import { OAuthClientSettingsModal } from './oauth-client'
import { CreateButtonType, DEFAULT_METHOD } from './types'

type Props = {
  className?: string
  buttonType?: CreateButtonType
  shape?: 'square' | 'circle'
}

const MAX_COUNT = 10

type CreateTypeOption = {
  value: SupportedCreationMethods
  label: string
  show: boolean
  extra?: React.ReactNode
  tag?: React.ReactNode
}

export const CreateSubscriptionButton = ({ buttonType = CreateButtonType.FULL_BUTTON, shape = 'square' }: Props) => {
  const { t } = useTranslation()
  const { subscriptions } = useSubscriptionList()
  const subscriptionCount = subscriptions?.length || 0
  const [selectedCreateInfo, setSelectedCreateInfo] = useState<{ type: SupportedCreationMethods, builder?: TriggerSubscriptionBuilder } | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const detail = usePluginStore(state => state.detail)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const { data: providerInfo } = useTriggerProviderInfo(detail?.provider || '')
  const supportedMethods = useMemo(() => providerInfo?.supported_creation_methods || [], [providerInfo?.supported_creation_methods])
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

  const onClickClientSettings = useCallback((e: React.MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setIsMenuOpen(false)
    showClientSettingsModal()
  }, [showClientSettingsModal])

  const handleClientSettingsOpenChange = useCallback((open: boolean) => {
    if (open) {
      showClientSettingsModal()
      return
    }

    hideClientSettingsModal()
    refetchOAuthConfig()
  }, [hideClientSettingsModal, refetchOAuthConfig, showClientSettingsModal])

  const allOptions = useMemo<CreateTypeOption[]>(() => {
    const showCustomBadge = oauthConfig?.custom_enabled && oauthConfig?.custom_configured

    return [
      {
        value: SupportedCreationMethods.OAUTH,
        label: t('subscription.addType.options.oauth.title', { ns: 'pluginTrigger' }),
        tag: !showCustomBadge
          ? null
          : (
              <Badge className="mr-0.5 ml-1">
                {t('auth.custom', { ns: 'plugin' })}
              </Badge>
            ),
        extra: (
          <Tooltip>
            <TooltipTrigger
              render={(
                <ActionButton
                  aria-label={t('subscription.addType.options.oauth.clientSettings', { ns: 'pluginTrigger' })}
                  onClick={onClickClientSettings}
                >
                  <span aria-hidden className="i-ri-equalizer-2-line h-4 w-4 text-text-tertiary" />
                </ActionButton>
              )}
            />
            <TooltipContent>
              {t('subscription.addType.options.oauth.clientSettings', { ns: 'pluginTrigger' })}
            </TooltipContent>
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
        extra: (
          <Tooltip>
            <TooltipTrigger
              render={(
                <span className="flex h-3.5 w-3.5 shrink-0 p-px">
                  <span aria-hidden className="i-ri-question-line h-full w-full text-text-quaternary hover:text-text-tertiary" />
                </span>
              )}
            />
            <TooltipContent>
              {t('subscription.addType.options.manual.tip', { ns: 'pluginTrigger' })}
            </TooltipContent>
          </Tooltip>
        ),
        show: supportedMethods.includes(SupportedCreationMethods.MANUAL),
      },
    ]
  }, [t, oauthConfig, supportedMethods, onClickClientSettings])
  const visibleOptions = useMemo(() => {
    return allOptions.filter(option => option.show)
  }, [allOptions])
  const shouldAllowSelect = methodType === DEFAULT_METHOD || (methodType === SupportedCreationMethods.OAUTH && supportedMethods.length === 1)

  const showCreateModal = useCallback((createInfo: { type: SupportedCreationMethods, builder?: TriggerSubscriptionBuilder }) => {
    setSelectedCreateInfo(createInfo)
    setIsCreateModalOpen(true)
  }, [])

  const hideCreateModal = useCallback(() => {
    setIsCreateModalOpen(false)
  }, [])

  const onChooseCreateType = async (type: SupportedCreationMethods) => {
    if (type === SupportedCreationMethods.OAUTH) {
      if (oauthConfig?.configured) {
        initiateOAuth(detail?.provider || '', {
          onSuccess: (response) => {
            openOAuthPopup(response.authorization_url, (callbackData) => {
              if (callbackData) {
                toast.success(t('modal.oauth.authorization.authSuccess', { ns: 'pluginTrigger' }))
                showCreateModal({
                  type: SupportedCreationMethods.OAUTH,
                  builder: response.subscription_builder,
                })
              }
            })
          },
          onError: () => {
            toast.error(t('modal.oauth.authorization.authFailed', { ns: 'pluginTrigger' }))
          },
        })
      }
      else {
        showClientSettingsModal()
      }
    }
    else {
      showCreateModal({
        type,
      })
    }
  }

  const handleCreateTypeChange = (value: string | null) => {
    const option = visibleOptions.find(item => item.value === value)
    if (!option)
      return

    setIsMenuOpen(false)
    void onChooseCreateType(option.value)
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
    onChooseCreateType(methodType!)
  }

  if (!supportedMethods.length)
    return null

  return (
    <>
      <Select
        value={methodType === DEFAULT_METHOD ? null : methodType}
        open={shouldAllowSelect ? isMenuOpen : false}
        onOpenChange={setIsMenuOpen}
        onValueChange={handleCreateTypeChange}
      >
        <SelectTrigger
          render={<div />}
          nativeButton={false}
          className={cn('h-8 border-0 bg-transparent px-0 hover:bg-transparent focus-visible:bg-transparent [&>*:last-child]:hidden', buttonType === CreateButtonType.FULL_BUTTON && 'grow')}
        >
          {buttonType === CreateButtonType.FULL_BUTTON
            ? (
                <Button
                  variant="primary"
                  size="medium"
                  className="flex w-full items-center justify-between px-0"
                  onClick={onClickCreate}
                >
                  <div className="flex flex-1 items-center justify-center">
                    <span aria-hidden className="mr-2 i-ri-add-line size-4" />
                    {buttonTextMap[methodType!]}
                    {methodType === SupportedCreationMethods.OAUTH && oauthConfig?.custom_enabled && oauthConfig?.custom_configured && (
                      <Badge
                        className="mr-0.5 ml-1 border-text-primary-on-surface bg-components-badge-bg-dimm text-text-primary-on-surface"
                      >
                        {t('auth.custom', { ns: 'plugin' })}
                      </Badge>
                    )}
                  </div>
                  {methodType === SupportedCreationMethods.OAUTH
                    && (
                      <div className="ml-auto flex items-center">
                        <div className="h-4 w-px bg-text-primary-on-surface opacity-15" />
                        <Tooltip>
                          <TooltipTrigger
                            render={(
                              <div onClick={onClickClientSettings} className="p-2">
                                <span aria-hidden className="i-ri-equalizer-2-line size-4 text-components-button-primary-text" />
                              </div>
                            )}
                          />
                          <TooltipContent>
                            {t('subscription.addType.options.oauth.clientSettings', { ns: 'pluginTrigger' })}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                </Button>
              )
            : (
                <Tooltip>
                  <TooltipTrigger
                    disabled={!(supportedMethods?.length === 1 || subscriptionCount >= MAX_COUNT)}
                    render={(
                      <ActionButton
                        aria-label={buttonTextMap[methodType!]}
                        onClick={onClickCreate}
                        className={cn(
                          'float-right',
                          shape === 'circle' && 'rounded-full! border-[0.5px] border-components-button-secondary-border-hover bg-components-button-secondary-bg-hover text-components-button-secondary-accent-text shadow-xs hover:border-components-button-secondary-border-disabled hover:bg-components-button-secondary-bg-disabled hover:text-components-button-secondary-accent-text-disabled',
                        )}
                        state={subscriptionCount >= MAX_COUNT ? ActionButtonState.Disabled : ActionButtonState.Default}
                      >
                        <span aria-hidden className="i-ri-add-line size-4" />
                      </ActionButton>
                    )}
                  />
                  <TooltipContent>
                    {subscriptionCount >= MAX_COUNT ? t('subscription.maxCount', { ns: 'pluginTrigger', num: MAX_COUNT }) : t(`subscription.addType.options.${methodType!.toLowerCase() as Lowercase<SupportedCreationMethods>}.description`, { ns: 'pluginTrigger' })}
                  </TooltipContent>
                </Tooltip>
              )}
        </SelectTrigger>
        <SelectContent placement="bottom-start" sideOffset={4}>
          {visibleOptions.map(option => (
            <SelectItem key={option.value} value={option.value}>
              <div className="mr-8 flex grow items-center gap-1 truncate px-1">
                {option.label}
                {option.tag}
              </div>
              {option.extra}
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedCreateInfo
        ? (
            <CommonCreateModal
              open={isCreateModalOpen}
              createType={selectedCreateInfo.type}
              builder={selectedCreateInfo.builder}
              onClose={hideCreateModal}
            />
          )
        : null}
      {isShowClientSettingsModal
        ? (
            <OAuthClientSettingsModal
              open={isShowClientSettingsModal}
              oauthConfig={oauthConfig}
              onOpenChange={handleClientSettingsOpenChange}
              showOAuthCreateModal={(builder) => {
                showCreateModal({
                  type: SupportedCreationMethods.OAUTH,
                  builder,
                })
              }}
            />
          )
        : null}
    </>
  )
}
