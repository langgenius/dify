import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  RiArrowDownSLine,
  RiEqualizer2Line,
  RiKey2Line,
  RiUserStarLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import AddOAuthButton from './authorize/add-oauth-button'
import AddApiKeyButton from './authorize/add-api-key-button'
import type { PluginPayload } from './types'
import cn from '@/utils/classnames'
import Switch from '@/app/components/base/switch'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type EndUserCredentialSectionProps = {
  pluginPayload: PluginPayload
  canOAuth?: boolean
  canApiKey?: boolean
  disabled?: boolean
  useEndUserCredentialEnabled?: boolean
  endUserCredentialType?: string
  onEndUserCredentialChange?: (enabled: boolean) => void
  onEndUserCredentialTypeChange?: (type: string) => void
  onCredentialAdded?: () => void
  className?: string
}

const EndUserCredentialSection = ({
  pluginPayload,
  canOAuth,
  canApiKey,
  disabled,
  useEndUserCredentialEnabled,
  endUserCredentialType,
  onEndUserCredentialChange,
  onEndUserCredentialTypeChange,
  onCredentialAdded,
  className,
}: EndUserCredentialSectionProps) => {
  const { t } = useTranslation()
  const [showEndUserTypeMenu, setShowEndUserTypeMenu] = useState(false)

  const availableEndUserTypes = useMemo(() => {
    const list: { value: string; label: string; icon: ReactNode }[] = []
    if (canOAuth) {
      list.push({
        value: 'oauth2',
        label: t('plugin.auth.endUserCredentials.optionOAuth'),
        icon: <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />,
      })
    }
    if (canApiKey) {
      list.push({
        value: 'api-key',
        label: t('plugin.auth.endUserCredentials.optionApiKey'),
        icon: <RiKey2Line className='h-4 w-4 text-text-tertiary' />,
      })
    }
    return list
  }, [canOAuth, canApiKey, t])

  const endUserCredentialLabel = useMemo(() => {
    const found = availableEndUserTypes.find(item => item.value === endUserCredentialType)
    return found?.label || availableEndUserTypes[0]?.label || '-'
  }, [availableEndUserTypes, endUserCredentialType])

  useEffect(() => {
    if (!useEndUserCredentialEnabled)
      return
    if (!availableEndUserTypes.length)
      return
    const isValid = availableEndUserTypes.some(item => item.value === endUserCredentialType)
    if (!isValid)
      onEndUserCredentialTypeChange?.(availableEndUserTypes[0].value)
  }, [useEndUserCredentialEnabled, endUserCredentialType, availableEndUserTypes, onEndUserCredentialTypeChange])

  const handleSelectEndUserType = useCallback((value: string) => {
    onEndUserCredentialTypeChange?.(value)
    setShowEndUserTypeMenu(false)
  }, [onEndUserCredentialTypeChange])

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <RiUserStarLine className='mt-0.5 h-4 w-4 shrink-0 text-text-tertiary' />
      <div className='flex-1 space-y-3'>
        <div className='flex items-center justify-between gap-3'>
          <div className='space-y-1'>
            <div className='system-sm-semibold text-text-primary'>
              {t('plugin.auth.endUserCredentials.title')}
            </div>
            <div className='system-xs-regular text-text-tertiary'>
              {t('plugin.auth.endUserCredentials.desc')}
            </div>
          </div>
          <Switch
            size='md'
            defaultValue={!!useEndUserCredentialEnabled}
            onChange={onEndUserCredentialChange}
            disabled={disabled}
          />
        </div>
        {
          useEndUserCredentialEnabled && availableEndUserTypes.length > 0 && (
            <div className='flex items-center justify-between gap-3'>
              <div className='system-sm-semibold text-text-primary'>
                {t('plugin.auth.endUserCredentials.typeLabel')}
              </div>
              <PortalToFollowElem
                open={showEndUserTypeMenu}
                onOpenChange={setShowEndUserTypeMenu}
                placement='bottom-end'
                offset={6}
              >
                <PortalToFollowElemTrigger asChild>
                  <button
                    type='button'
                    className='border-components-input-border flex h-9 min-w-[190px] items-center justify-between rounded-lg border bg-components-input-bg-normal px-3 text-left text-text-primary shadow-xs hover:bg-components-input-bg-hover'
                    onClick={() => setShowEndUserTypeMenu(v => !v)}
                  >
                    <span className='system-sm-semibold'>{endUserCredentialLabel}</span>
                    <RiArrowDownSLine className='h-4 w-4 text-text-tertiary' />
                  </button>
                </PortalToFollowElemTrigger>
                <PortalToFollowElemContent className='z-[120]'>
                  <div className='w-[220px] rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg'>
                    <div className='flex flex-col gap-1 p-1'>
                      {canOAuth && (
                        <AddOAuthButton
                          pluginPayload={pluginPayload}
                          buttonVariant='ghost'
                          className='w-full justify-between bg-transparent text-text-primary hover:bg-transparent'
                          buttonText={t('plugin.auth.addOAuth')}
                          disabled={disabled}
                          onUpdate={() => {
                            handleSelectEndUserType('oauth2')
                            onCredentialAdded?.()
                          }}
                        />
                      )}
                      {canApiKey && (
                        <AddApiKeyButton
                          pluginPayload={pluginPayload}
                          buttonVariant='ghost'
                          buttonText={t('plugin.auth.addApi')}
                          disabled={disabled}
                          onUpdate={() => {
                            handleSelectEndUserType('api-key')
                            onCredentialAdded?.()
                          }}
                        />
                      )}
                    </div>
                  </div>
                </PortalToFollowElemContent>
              </PortalToFollowElem>
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(EndUserCredentialSection)
