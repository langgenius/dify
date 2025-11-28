import {
  memo,
  useState,
} from 'react'
import {
  RiAddLine,
  RiKey2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import AddOAuthButton from './authorize/add-oauth-button'
import AddApiKeyButton from './authorize/add-api-key-button'
import type { PluginPayload } from './types'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type CredentialConfigHeaderProps = {
  pluginPayload: PluginPayload
  canOAuth?: boolean
  canApiKey?: boolean
  hasOAuthClientConfigured?: boolean
  disabled?: boolean
  onCredentialAdded?: () => void
  onAddMenuOpenChange?: (open: boolean) => void
}

const CredentialConfigHeader = ({
  pluginPayload,
  canOAuth,
  canApiKey,
  hasOAuthClientConfigured,
  disabled,
  onCredentialAdded,
  onAddMenuOpenChange,
}: CredentialConfigHeaderProps) => {
  const { t } = useTranslation()
  const [showAddMenu, setShowAddMenu] = useState(false)

  const handleAddMenuOpenChange = (open: boolean) => {
    setShowAddMenu(open)
    onAddMenuOpenChange?.(open)
  }

  const addButtonDisabled = disabled || (!canOAuth && !canApiKey && !hasOAuthClientConfigured)

  return (
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
        onOpenChange={handleAddMenuOpenChange}
        placement='bottom-end'
        offset={6}
      >
        <PortalToFollowElemTrigger asChild>
          <button
            type='button'
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-700',
              addButtonDisabled && 'pointer-events-none opacity-50',
            )}
            onClick={() => handleAddMenuOpenChange(!showAddMenu)}
          >
            <RiAddLine className='h-5 w-5' />
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
                    setShowAddMenu(false)
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
                    setShowAddMenu(false)
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

export default memo(CredentialConfigHeader)
