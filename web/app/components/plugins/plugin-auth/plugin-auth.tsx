import {
  memo,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiKey2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Authorize from './authorize'
import Authorized from './authorized'
import AddApiKeyButton from './authorize/add-api-key-button'
import AddOAuthButton from './authorize/add-oauth-button'
import EndUserCredentialSection from './end-user-credential-section'
import Item from './authorized/item'
import type { PluginPayload } from './types'
import { usePluginAuth } from './hooks/use-plugin-auth'
import cn from '@/utils/classnames'

type PluginAuthProps = {
  pluginPayload: PluginPayload
  children?: React.ReactNode
  className?: string
  showConnectGuide?: boolean
  endUserCredentialEnabled?: boolean
  endUserCredentialType?: string
  onEndUserCredentialTypeChange?: (type: string) => void
  onEndUserCredentialChange?: (enabled: boolean) => void
}
const PluginAuth = ({
  pluginPayload,
  children,
  className,
  showConnectGuide,
  endUserCredentialEnabled,
  endUserCredentialType,
  onEndUserCredentialTypeChange,
  onEndUserCredentialChange,
}: PluginAuthProps) => {
  const { t } = useTranslation()
  const {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials,
    disabled,
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
    hasOAuthClientConfigured,
  } = usePluginAuth(pluginPayload, !!pluginPayload.provider)
  const shouldShowGuide = !!showConnectGuide
  const [showCredentialPanel, setShowCredentialPanel] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const configuredDisabled = !!endUserCredentialEnabled
  const shouldShowAuthorizeCard = useMemo(() => {
    const hasCredential = credentials.length > 0
    const canAdd = canOAuth || canApiKey || hasOAuthClientConfigured
    return !hasCredential && canAdd
  }, [credentials.length, canOAuth, canApiKey, hasOAuthClientConfigured])
  const containerClassName = useMemo(() => {
    if (showConnectGuide)
      return className
    return !isAuthorized ? className : undefined
  }, [isAuthorized, className, showConnectGuide])

  useEffect(() => {
    if (isAuthorized)
      setShowCredentialPanel(false)
  }, [isAuthorized])

  const credentialList = useMemo(() => {
    return (
      <div className={cn(!credentials.length ? 'mt-0' : 'mt-3')}>
        {
          credentials.length > 0
            ? (
              <div className='space-y-1'>
                {credentials.map(credential => (
                  <Item
                    key={credential.id}
                    credential={credential}
                    disabled
                    disableRename
                    disableEdit
                    disableDelete
                    disableSetDefault
                  />
                ))}
              </div>
            )
            : null
        }
      </div>
    )
  }, [credentials, t])

  const endUserSwitch = (
    <EndUserCredentialSection
      className='px-4 py-3'
      pluginPayload={pluginPayload}
      canOAuth={canOAuth}
      canApiKey={canApiKey}
      disabled={disabled}
      useEndUserCredentialEnabled={endUserCredentialEnabled}
      endUserCredentialType={endUserCredentialType}
      onEndUserCredentialChange={onEndUserCredentialChange}
      onEndUserCredentialTypeChange={onEndUserCredentialTypeChange}
      onCredentialAdded={invalidPluginCredentialInfo}
    />
  )

  return (
    <div className={cn(containerClassName)}>
      {
        shouldShowGuide && (
          <PortalToFollowElem
            open={showCredentialPanel}
            onOpenChange={setShowCredentialPanel}
            placement='bottom-start'
            offset={8}
            triggerPopupSameWidth
          >
            <PortalToFollowElemTrigger asChild>
              <button
                type='button'
                className='flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-left text-white shadow-xs hover:bg-primary-700'
                onClick={() => setShowCredentialPanel(v => !v)}
              >
                <div className='system-sm-semibold text-white'>
                  {t('plugin.auth.connectCredentials')}
                </div>
                <RiArrowDownSLine
                  className={cn(
                    'h-4 w-4 text-white transition-transform',
                    showCredentialPanel && 'rotate-180',
                  )}
                />
              </button>
            </PortalToFollowElemTrigger>
            <PortalToFollowElemContent className='z-[100]'>
              <div className='w-[420px] max-w-[calc(100vw-48px)] rounded-2xl border border-divider-subtle bg-components-panel-bg shadow-lg'>
                <div className='border-b border-divider-subtle px-3 py-3'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='flex items-start gap-2'>
                      <RiKey2Line className='mt-0.5 h-4 w-4 text-text-tertiary' />
                      <div className='space-y-0.5'>
                        <div className='system-md-semibold text-text-primary'>
                          {t('plugin.auth.configuredCredentials.title')}
                        </div>
                        <div className='system-xs-regular text-text-tertiary'>
                          {t('plugin.auth.configuredCredentials.desc')}
                        </div>
                      </div>
                    </div>
                    <PortalToFollowElem
                      open={showAddMenu}
                      onOpenChange={setShowAddMenu}
                      placement='bottom-end'
                      offset={6}
                    >
                      <PortalToFollowElemTrigger asChild>
                        <button
                          type='button'
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-700',
                            configuredDisabled && 'pointer-events-none opacity-50',
                          )}
                          onClick={() => {
                            setShowCredentialPanel(true)
                            setShowAddMenu(v => !v)
                          }}
                        >
                          <RiAddLine className='h-5 w-5' />
                        </button>
                      </PortalToFollowElemTrigger>
                      <PortalToFollowElemContent className='z-[120]'>
                        <div className='w-[220px] rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg'>
                          <div className='flex flex-col gap-1 p-1'>
                            {
                              canOAuth && (
                                <AddOAuthButton
                                  pluginPayload={pluginPayload}
                                  buttonVariant='ghost'
                                  className='w-full justify-between bg-transparent text-text-primary hover:bg-transparent'
                                  buttonText={t('plugin.auth.addOAuth')}
                                  disabled={disabled}
                                  onUpdate={() => {
                                    setShowAddMenu(false)
                                    invalidPluginCredentialInfo()
                                  }}
                                />
                              )
                            }
                            {
                              canApiKey && (
                                <AddApiKeyButton
                                  pluginPayload={pluginPayload}
                                  buttonVariant='ghost'
                                  buttonText={t('plugin.auth.addApi')}
                                  disabled={disabled}
                                  onUpdate={() => {
                                    setShowAddMenu(false)
                                    invalidPluginCredentialInfo()
                                  }}
                                />
                              )
                            }
                          </div>
                        </div>
                      </PortalToFollowElemContent>
                    </PortalToFollowElem>
                  </div>
                  <div className={cn(configuredDisabled && 'pointer-events-none opacity-50')}>
                    {credentialList}
                  </div>
                  {
                    shouldShowAuthorizeCard && (
                      <div className={cn(
                        'mt-4 flex items-start gap-1.5 rounded-xl bg-background-section px-4 py-8',
                        configuredDisabled && 'pointer-events-none opacity-50',
                      )}>
                        <div className='flex w-full justify-center'>
                          <div className='w-full max-w-[520px]'>
                            <Authorize
                              pluginPayload={pluginPayload}
                              canOAuth={canOAuth}
                              canApiKey={canApiKey}
                              disabled={disabled || configuredDisabled}
                              onUpdate={invalidPluginCredentialInfo}
                              notAllowCustomCredential={notAllowCustomCredential}
                              theme='secondary'
                              showDivider={!!(canOAuth && canApiKey)}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  }
                </div>
                {endUserSwitch}
              </div>
            </PortalToFollowElemContent>
          </PortalToFollowElem>
        )
      }
      {
        !shouldShowGuide && !isAuthorized && (
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={canOAuth}
            canApiKey={canApiKey}
            disabled={disabled}
            onUpdate={invalidPluginCredentialInfo}
            notAllowCustomCredential={notAllowCustomCredential}
          />
        )
      }
      {
        isAuthorized && !children && (
          <Authorized
            pluginPayload={pluginPayload}
            credentials={credentials}
            canOAuth={canOAuth}
            canApiKey={canApiKey}
            disabled={disabled}
            onUpdate={invalidPluginCredentialInfo}
            notAllowCustomCredential={notAllowCustomCredential}
          />
        )
      }
      {
        isAuthorized && children
      }
    </div>
  )
}

export default memo(PluginAuth)
