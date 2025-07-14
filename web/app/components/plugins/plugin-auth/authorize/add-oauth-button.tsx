import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiClipboardLine,
  RiEqualizer2Line,
  RiInformation2Fill,
} from '@remixicon/react'
import Button from '@/app/components/base/button'
import type { ButtonProps } from '@/app/components/base/button'
import OAuthClientSettings from './oauth-client-settings'
import cn from '@/utils/classnames'
import type { PluginPayload } from '../types'
import { openOAuthPopup } from '@/hooks/use-oauth'
import Badge from '@/app/components/base/badge'
import {
  useGetPluginOAuthClientSchemaHook,
  useGetPluginOAuthUrlHook,
  useInvalidPluginCredentialInfoHook,
} from '../hooks/use-credential'
import type { FormSchema } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import ActionButton from '@/app/components/base/action-button'
import { useRenderI18nObject } from '@/hooks/use-i18n'

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
  const { t } = useTranslation()
  const renderI18nObject = useRenderI18nObject()
  const [isOAuthSettingsOpen, setIsOAuthSettingsOpen] = useState(false)
  const { mutateAsync: getPluginOAuthUrl } = useGetPluginOAuthUrlHook(pluginPayload)
  const { data } = useGetPluginOAuthClientSchemaHook(pluginPayload)
  const {
    schema = [],
    is_oauth_custom_client_enabled,
    is_system_oauth_params_exists,
    client_params,
    redirect_uri,
  } = data || {}

  const isConfigured = is_system_oauth_params_exists || !!client_params
  const invalidatePluginCredentialInfo = useInvalidPluginCredentialInfoHook(pluginPayload)
  const handleOAuth = useCallback(async () => {
    const { authorization_url } = await getPluginOAuthUrl()

    if (authorization_url) {
      openOAuthPopup(
        authorization_url,
        invalidatePluginCredentialInfo,
      )
    }
  }, [getPluginOAuthUrl, invalidatePluginCredentialInfo])

  const renderCustomLabel = useCallback((item: FormSchema) => {
    return (
      <div className='w-full'>
        <div className='mb-4 flex rounded-xl bg-background-section-burn p-4'>
          <div className='mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg'>
            <RiInformation2Fill className='h-5 w-5 text-text-accent' />
          </div>
          <div className='w-0 grow'>
            <div className='system-sm-regular mb-1.5'>
              {t('plugin.auth.clientInfo')}
            </div>
            {
              redirect_uri && (
                <div className='system-sm-medium flex w-full py-0.5'>
                  <div className='w-0 grow break-words'>{redirect_uri}</div>
                  <ActionButton
                    className='shrink-0'
                    onClick={() => {
                      navigator.clipboard.writeText(redirect_uri || '')
                    }}
                  >
                    <RiClipboardLine className='h-4 w-4' />
                  </ActionButton>
                </div>
              )
            }
          </div>
        </div>
        <div className='system-sm-medium flex h-6 items-center text-text-secondary'>
          {renderI18nObject(item.label as Record<string, string>)}
        </div>
      </div>
    )
  }, [t, redirect_uri, renderI18nObject])
  const memorizedSchemas = useMemo(() => {
    const result: FormSchema[] = schema.map((item, index) => {
      return {
        ...item,
        label: index === 0 ? renderCustomLabel(item) : item.label,
        labelClassName: index === 0 ? 'h-auto' : undefined,
      }
    })
    if (is_system_oauth_params_exists) {
      result.unshift({
        name: '__oauth_client__',
        label: t('plugin.auth.oauthClient'),
        type: FormTypeEnum.radio,
        options: [
          {
            label: t('plugin.auth.default'),
            value: 'default',
          },
          {
            label: t('plugin.auth.custom'),
            value: 'custom',
          },
        ],
        required: false,
        default: is_oauth_custom_client_enabled ? 'custom' : 'default',
      } as FormSchema)
      result.forEach((item, index) => {
        if (index > 0) {
          item.show_on = [
            {
              variable: '__oauth_client__',
              value: 'custom',
            },
          ]
          if (client_params)
            item.default = client_params[item.name] || item.default
        }
      })
    }

    return result
  }, [schema, renderCustomLabel, t, is_system_oauth_params_exists, is_oauth_custom_client_enabled, client_params])

  return (
    <>
      {
        isConfigured && (
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
              {
                is_oauth_custom_client_enabled && (
                  <Badge
                    className='ml-1 border-text-primary-on-surface bg-components-badge-bg-dimm text-text-primary-on-surface'
                  >
                    {t('plugin.auth.custom')}
                  </Badge>
                )
              }
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
        )
      }
      {
        !isConfigured && (
          <Button
            variant={buttonVariant}
            onClick={() => setIsOAuthSettingsOpen(true)}
            disabled={disabled}
          >
            <RiEqualizer2Line className='mr-0.5 h-4 w-4' />
            {t('plugin.auth.setupOAuth')}
          </Button>
        )
      }
      {
        isOAuthSettingsOpen && (
          <OAuthClientSettings
            pluginPayload={pluginPayload}
            onClose={() => setIsOAuthSettingsOpen(false)}
            disabled={disabled}
            schemas={memorizedSchemas}
            onAuth={handleOAuth}
            editValues={client_params}
          />
        )
      }
    </>
  )
}

export default memo(AddOAuthButton)
