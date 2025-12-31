import type { PluginPayload } from '../types'
import type { AddApiKeyButtonProps } from './add-api-key-button'
import type { AddOAuthButtonProps } from './add-oauth-button'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import AddApiKeyButton from './add-api-key-button'
import AddOAuthButton from './add-oauth-button'

type AuthorizeProps = {
  pluginPayload: PluginPayload
  theme?: 'primary' | 'secondary'
  showDivider?: boolean
  canOAuth?: boolean
  canApiKey?: boolean
  disabled?: boolean
  onUpdate?: () => void
  notAllowCustomCredential?: boolean
}
const Authorize = ({
  pluginPayload,
  theme = 'primary',
  showDivider = true,
  canOAuth,
  canApiKey,
  disabled,
  onUpdate,
  notAllowCustomCredential,
}: AuthorizeProps) => {
  const { t } = useTranslation()
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
      }
    }
    return {
      pluginPayload,
      buttonText: !canOAuth ? t('auth.useApiAuth', { ns: 'plugin' }) : t('auth.addApi', { ns: 'plugin' }),
      buttonVariant: !canOAuth ? 'primary' : 'secondary-accent',
    }
  }, [canOAuth, theme, pluginPayload, t])

  const OAuthButton = useMemo(() => {
    const Item = (
      <div className={cn('min-w-0 flex-[1]', notAllowCustomCredential && 'opacity-50')}>
        <AddOAuthButton
          {...oAuthButtonProps}
          disabled={disabled || notAllowCustomCredential}
          onUpdate={onUpdate}
        />
      </div>
    )

    if (notAllowCustomCredential) {
      return (
        <Tooltip popupContent={t('auth.credentialUnavailable', { ns: 'plugin' })}>
          {Item}
        </Tooltip>
      )
    }
    return Item
  }, [notAllowCustomCredential, oAuthButtonProps, disabled, onUpdate, t])

  const ApiKeyButton = useMemo(() => {
    const Item = (
      <div className={cn('min-w-0 flex-[1]', notAllowCustomCredential && 'opacity-50')}>
        <AddApiKeyButton
          {...apiKeyButtonProps}
          disabled={disabled || notAllowCustomCredential}
          onUpdate={onUpdate}
        />
      </div>
    )

    if (notAllowCustomCredential) {
      return (
        <Tooltip popupContent={t('auth.credentialUnavailable', { ns: 'plugin' })}>
          {Item}
        </Tooltip>
      )
    }
    return Item
  }, [notAllowCustomCredential, apiKeyButtonProps, disabled, onUpdate, t])

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
            <div className="system-2xs-medium-uppercase flex shrink-0 flex-col items-center justify-between text-text-tertiary">
              <div className="h-2 w-[1px] bg-divider-subtle"></div>
              or
              <div className="h-2 w-[1px] bg-divider-subtle"></div>
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
