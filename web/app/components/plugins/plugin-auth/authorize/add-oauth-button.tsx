import {
  memo,
  useCallback,
  useState,
} from 'react'
import { RiEqualizer2Line } from '@remixicon/react'
import Button from '@/app/components/base/button'
import type { ButtonProps } from '@/app/components/base/button'
import OAuthClientSettings from './oauth-client-settings'
import cn from '@/utils/classnames'
import type { PluginPayload } from '../types'
import { openOAuthPopup } from '@/hooks/use-oauth'
import {
  useGetPluginOAuthUrlHook,
} from '../hooks/use-credential'

export type AddOAuthButtonProps = {
  pluginPayload: PluginPayload
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
  className?: string
  buttonLeftClassName?: string
  buttonRightClassName?: string
  dividerClassName?: string
  disabled?: boolean
}
const AddOAuthButton = ({
  pluginPayload,
  buttonVariant = 'primary',
  buttonText = 'use oauth',
  className,
  buttonLeftClassName,
  buttonRightClassName,
  dividerClassName,
  disabled,
}: AddOAuthButtonProps) => {
  const [isOAuthSettingsOpen, setIsOAuthSettingsOpen] = useState(false)
  const { mutateAsync: getPluginOAuthUrl } = useGetPluginOAuthUrlHook(pluginPayload)

  const handleOAuth = useCallback(async () => {
    const { authorization_url } = await getPluginOAuthUrl()

    if (authorization_url) {
      openOAuthPopup(
        authorization_url,
        () => {
          console.log('success')
        },
      )
    }
  }, [getPluginOAuthUrl])

  return (
    <>
      <Button
        variant={buttonVariant}
        className={cn(
          'grow px-0 py-0 hover:bg-components-button-primary-bg',
          className,
        )}
        disabled={disabled}
        onClick={handleOAuth}
      >
        <div className={cn(
          'flex h-full grow items-center justify-center rounded-l-lg hover:bg-components-button-primary-bg-hover',
          buttonLeftClassName,
        )}>
          {buttonText}
        </div>
        <div className={cn(
          'h-4 w-[1px] bg-text-primary-on-surface opacity-[0.15]',
          dividerClassName,
        )}></div>
        <div
          className={cn(
            'flex h-full w-8 shrink-0 items-center justify-center rounded-r-lg hover:bg-components-button-primary-bg-hover',
            buttonRightClassName,
          )}
          onClick={(e) => {
            e.stopPropagation()
            setIsOAuthSettingsOpen(true)
          }}
        >
          <RiEqualizer2Line className='h-4 w-4' />
        </div>
      </Button>
      {
        isOAuthSettingsOpen && (
          <OAuthClientSettings
            pluginPayload={pluginPayload}
            onClose={() => setIsOAuthSettingsOpen(false)}
            disabled={disabled}
          />
        )
      }
    </>
  )
}

export default memo(AddOAuthButton)
