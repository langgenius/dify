import type { PluginPayload } from '../types'
import type { AddApiKeyButtonProps } from './add-api-key-button'
import type { AddOAuthButtonProps } from './add-oauth-button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import AddApiKeyButton from './add-api-key-button'
import AddOAuthButton from './add-oauth-button'

type AuthorizeProps = {
  pluginPayload: PluginPayload
  theme?: 'primary' | 'secondary'
  showDivider?: boolean
  canOAuth?: boolean
  canApiKey?: boolean
  onUpdate?: () => void
  notAllowCustomCredential?: boolean
  /**
   * If provided, the API-key button delegates modal-opening to the parent
   * instead of rendering it inline. Used when this Authorize is mounted
   * inside a Popover whose outside-click handler would otherwise unmount
   * the modal.
   */
  onApiKeyClick?: () => void
}
const Authorize = ({
  pluginPayload,
  theme = 'primary',
  showDivider = true,
  canOAuth,
  canApiKey,
  onUpdate,
  notAllowCustomCredential,
  onApiKeyClick,
}: AuthorizeProps) => {
  const { t } = useTranslation()
  const { canCreateCredential } = useCredentialPermissions()

  const oAuthButtonProps: AddOAuthButtonProps = useMemo(() => {
    if (theme === 'secondary') {
      return {
        buttonText: !canApiKey ? t('auth.useOAuthAuth', { ns: 'plugin' }) : t('auth.addOAuth', { ns: 'plugin' }),
        buttonVariant: 'secondary',
        className: 'hover:bg-components-button-secondary-bg',
        buttonLeftClassName: 'hover:bg-components-button-secondary-bg-hover',
        buttonRightClassName: 'hover:bg-components-button-secondary-bg-hover',
        dividerClassName: 'bg-divider-regular opacity-100',
        pluginPayload,
      }
    }

    return {
      buttonText: !canApiKey ? t('auth.useOAuthAuth', { ns: 'plugin' }) : t('auth.addOAuth', { ns: 'plugin' }),
      pluginPayload,
    }
  }, [canApiKey, theme, pluginPayload, t])

  const apiKeyButtonProps: AddApiKeyButtonProps = useMemo(() => {
    if (theme === 'secondary') {
      return {
        pluginPayload,
        buttonVariant: 'secondary',
        buttonText: !canOAuth ? t('auth.useApiAuth', { ns: 'plugin' }) : t('auth.addApi', { ns: 'plugin' }),
        onClick: onApiKeyClick,
      }
    }
    return {
      pluginPayload,
      buttonText: !canOAuth ? t('auth.useApiAuth', { ns: 'plugin' }) : t('auth.addApi', { ns: 'plugin' }),
      buttonVariant: !canOAuth ? 'primary' : 'secondary-accent',
      onClick: onApiKeyClick,
    }
  }, [canOAuth, theme, pluginPayload, t, onApiKeyClick])

  const OAuthButton = useMemo(() => {
    const Item = (
      <div className={cn('min-w-0 flex-1', notAllowCustomCredential && 'opacity-50')}>
        <AddOAuthButton
          {...oAuthButtonProps}
          disabled={!canCreateCredential || notAllowCustomCredential}
          onUpdate={onUpdate}
        />
      </div>
    )

    if (notAllowCustomCredential) {
      return (
        <Tooltip>
          <TooltipTrigger render={Item} />
          <TooltipContent>
            {t('auth.credentialUnavailable', { ns: 'plugin' })}
          </TooltipContent>
        </Tooltip>
      )
    }
    return Item
  }, [notAllowCustomCredential, oAuthButtonProps, canCreateCredential, onUpdate, t])

  const ApiKeyButton = useMemo(() => {
    const Item = (
      <div className={cn('min-w-0 flex-1', notAllowCustomCredential && 'opacity-50')}>
        <AddApiKeyButton
          {...apiKeyButtonProps}
          disabled={!canCreateCredential || notAllowCustomCredential}
          onUpdate={onUpdate}
        />
      </div>
    )

    if (notAllowCustomCredential) {
      return (
        <Tooltip>
          <TooltipTrigger render={Item} />
          <TooltipContent>
            {t('auth.credentialUnavailable', { ns: 'plugin' })}
          </TooltipContent>
        </Tooltip>
      )
    }
    return Item
  }, [notAllowCustomCredential, apiKeyButtonProps, canCreateCredential, onUpdate, t])

  return (
    <>
      <div className="flex items-center space-x-1.5">
        {
          canOAuth && (
            OAuthButton
          )
        }
        {
          showDivider && canOAuth && canApiKey && (
            <div className="flex shrink-0 flex-col items-center justify-between system-2xs-medium-uppercase text-text-tertiary">
              <div className="h-2 w-px bg-divider-subtle"></div>
              or
              <div className="h-2 w-px bg-divider-subtle"></div>
            </div>
          )
        }
        {
          canApiKey && (
            ApiKeyButton
          )
        }
      </div>
    </>
  )
}

export default memo(Authorize)
