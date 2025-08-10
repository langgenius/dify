import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import AddOAuthButton from './add-oauth-button'
import type { AddOAuthButtonProps } from './add-oauth-button'
import AddApiKeyButton from './add-api-key-button'
import type { AddApiKeyButtonProps } from './add-api-key-button'
import type { PluginPayload } from '../types'

type AuthorizeProps = {
  pluginPayload: PluginPayload
  theme?: 'primary' | 'secondary'
  showDivider?: boolean
  canOAuth?: boolean
  canApiKey?: boolean
  disabled?: boolean
  onUpdate?: () => void
}
const Authorize = ({
  pluginPayload,
  theme = 'primary',
  showDivider = true,
  canOAuth,
  canApiKey,
  disabled,
  onUpdate,
}: AuthorizeProps) => {
  const { t } = useTranslation()
  const oAuthButtonProps: AddOAuthButtonProps = useMemo(() => {
    if (theme === 'secondary') {
      return {
        buttonText: !canApiKey ? t('plugin.auth.useOAuthAuth') : t('plugin.auth.addOAuth'),
        buttonVariant: 'secondary',
        className: 'hover:bg-components-button-secondary-bg',
        buttonLeftClassName: 'hover:bg-components-button-secondary-bg-hover',
        buttonRightClassName: 'hover:bg-components-button-secondary-bg-hover',
        dividerClassName: 'bg-divider-regular opacity-100',
        pluginPayload,
      }
    }

    return {
      buttonText: !canApiKey ? t('plugin.auth.useOAuthAuth') : t('plugin.auth.addOAuth'),
      pluginPayload,
    }
  }, [canApiKey, theme, pluginPayload, t])

  const apiKeyButtonProps: AddApiKeyButtonProps = useMemo(() => {
    if (theme === 'secondary') {
      return {
        pluginPayload,
        buttonVariant: 'secondary',
        buttonText: !canOAuth ? t('plugin.auth.useApiAuth') : t('plugin.auth.addApi'),
      }
    }
    return {
      pluginPayload,
      buttonText: !canOAuth ? t('plugin.auth.useApiAuth') : t('plugin.auth.addApi'),
      buttonVariant: !canOAuth ? 'primary' : 'secondary-accent',
    }
  }, [canOAuth, theme, pluginPayload, t])

  return (
    <>
      <div className='flex items-center space-x-1.5'>
        {
          canOAuth && (
            <div className='min-w-0 flex-[1]'>
              <AddOAuthButton
                {...oAuthButtonProps}
                disabled={disabled}
                onUpdate={onUpdate}
              />
            </div>
          )
        }
        {
          showDivider && canOAuth && canApiKey && (
            <div className='system-2xs-medium-uppercase flex shrink-0 flex-col items-center justify-between text-text-tertiary'>
              <div className='h-2 w-[1px] bg-divider-subtle'></div>
              or
              <div className='h-2 w-[1px] bg-divider-subtle'></div>
            </div>
          )
        }
        {
          canApiKey && (
            <div className='min-w-0 flex-[1]'>
              <AddApiKeyButton
                {...apiKeyButtonProps}
                disabled={disabled}
                onUpdate={onUpdate}
              />
            </div>
          )
        }
      </div>
    </>
  )
}

export default memo(Authorize)
