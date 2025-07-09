import {
  memo,
  useMemo,
} from 'react'
import AddOAuthButton from './add-oauth-button'
import type { AddOAuthButtonProps } from './add-oauth-button'
import AddApiKeyButton from './add-api-key-button'
import type { AddApiKeyButtonProps } from './add-api-key-button'

type AuthorizeProps = {
  provider?: string
  theme?: 'primary' | 'secondary'
  showDivider?: boolean
  canOAuth?: boolean
  canApiKey?: boolean
  disabled?: boolean
}
const Authorize = ({
  provider = '',
  theme = 'primary',
  showDivider = true,
  canOAuth,
  canApiKey,
  disabled,
}: AuthorizeProps) => {
  const oAuthButtonProps: AddOAuthButtonProps = useMemo(() => {
    if (theme === 'secondary') {
      return {
        buttonText: !canApiKey ? 'Add OAuth Authorization' : 'Add OAuth',
        buttonVariant: 'secondary',
        className: 'hover:bg-components-button-secondary-bg',
        buttonLeftClassName: 'hover:bg-components-button-secondary-bg-hover',
        buttonRightClassName: 'hover:bg-components-button-secondary-bg-hover',
        dividerClassName: 'bg-divider-regular opacity-100',
      }
    }

    return {
      buttonText: !canApiKey ? 'Use OAuth Authorization' : 'Use OAuth',
    }
  }, [canApiKey, theme])

  const apiKeyButtonProps: AddApiKeyButtonProps = useMemo(() => {
    if (theme === 'secondary') {
      return {
        provider,
        buttonVariant: 'secondary',
        buttonText: !canOAuth ? 'API Key Authorization Configuration' : 'Add API Key',
      }
    }
    return {
      provider,
      buttonText: !canOAuth ? 'API Key Authorization Configuration' : 'Use API Key',
      buttonVariant: !canOAuth ? 'primary' : 'secondary-accent',
    }
  }, [canOAuth, theme, provider])

  return (
    <>
      <div className='flex items-center space-x-1.5'>
        {
          canOAuth && (
            <AddOAuthButton
              {...oAuthButtonProps}
              disabled={disabled}
            />
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
            <AddApiKeyButton
              {...apiKeyButtonProps}
              disabled={disabled}
            />
          )
        }
      </div>
    </>
  )
}

export default memo(Authorize)
