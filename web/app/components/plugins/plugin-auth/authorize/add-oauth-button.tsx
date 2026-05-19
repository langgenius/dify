import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { openOAuthPopup } from '@/hooks/use-oauth'
import {
  useGetPluginOAuthClientSchemaHook,
  useGetPluginOAuthUrlHook,
} from '../hooks/use-credential'
import OAuthClientSettings from './oauth-client-settings'

export type AddOAuthButtonProps = {
  pluginPayload: PluginPayload
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
  className?: string
  buttonLeftClassName?: string
  buttonRightClassName?: string
  dividerClassName?: string
  disabled?: boolean
  onUpdate?: () => void
  oAuthData?: {
    schema?: FormSchema[]
    is_oauth_custom_client_enabled?: boolean
    is_system_oauth_params_exists?: boolean
    client_params?: Record<string, unknown>
    redirect_uri?: string
  }
}
type OAuthData = NonNullable<AddOAuthButtonProps['oAuthData']>

const AddOAuthButton = ({
  pluginPayload,
  buttonVariant = 'primary',
  buttonText = 'use oauth',
  className,
  buttonLeftClassName,
  buttonRightClassName,
  dividerClassName,
  disabled,
  onUpdate,
  oAuthData,
}: AddOAuthButtonProps) => {
  const { t } = useTranslation()
  const renderI18nObject = useRenderI18nObject()
  const [isOAuthSettingsOpen, setIsOAuthSettingsOpen] = useState(false)
  const [isOAuthSettingsMounted, setIsOAuthSettingsMounted] = useState(false)
  const { mutateAsync: getPluginOAuthUrl } = useGetPluginOAuthUrlHook(pluginPayload)
  const { data, isLoading } = useGetPluginOAuthClientSchemaHook(pluginPayload)
  const mergedOAuthData = useMemo<OAuthData>(() => {
    if (oAuthData)
      return oAuthData

    return data || {}
  }, [oAuthData, data])
  const {
    schema = [],
    is_oauth_custom_client_enabled,
    is_system_oauth_params_exists,
    client_params = {},
    redirect_uri,
  } = mergedOAuthData
  const isConfigured = is_system_oauth_params_exists || is_oauth_custom_client_enabled
  const openOAuthSettings = useCallback(() => {
    setIsOAuthSettingsMounted(true)
    setIsOAuthSettingsOpen(true)
  }, [])
  const handleOAuth = useCallback(async () => {
    const { authorization_url } = await getPluginOAuthUrl()

    if (authorization_url) {
      openOAuthPopup(
        authorization_url,
        () => onUpdate?.(),
      )
    }
  }, [getPluginOAuthUrl, onUpdate])

  const renderCustomLabel = useCallback((item: FormSchema) => {
    return (
      <div className="w-full">
        <div className="mb-4 flex rounded-xl bg-background-section-burn p-4">
          <div className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg">
            <span className="i-ri-information-2-fill h-5 w-5 text-text-accent" />
          </div>
          <div className="w-0 grow">
            <div className="mb-1.5 system-sm-regular">
              {t('auth.clientInfo', { ns: 'plugin' })}
            </div>
            {
              redirect_uri && (
                <div className="flex w-full py-0.5 system-sm-medium">
                  <div className="w-0 grow wrap-break-word break-all">{redirect_uri}</div>
                  <ActionButton
                    className="shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(redirect_uri || '')
                    }}
                  >
                    <span className="i-ri-clipboard-line h-4 w-4" />
                  </ActionButton>
                </div>
              )
            }
          </div>
        </div>
        <div className="flex h-6 items-center system-sm-medium text-text-secondary">
          {renderI18nObject(item.label as Record<string, string>)}
          {
            item.required && (
              <span className="ml-1 text-text-destructive-secondary">*</span>
            )
          }
        </div>
      </div>
    )
  }, [t, redirect_uri, renderI18nObject])
  const memorizedSchemas = useMemo(() => {
    const result: FormSchema[] = (schema as FormSchema[]).map((item, index) => {
      return {
        ...item,
        label: index === 0 ? renderCustomLabel(item) : item.label,
        labelClassName: index === 0 ? 'h-auto' : undefined,
      }
    })
    if (is_system_oauth_params_exists) {
      result.unshift({
        name: '__oauth_client__',
        label: t('auth.oauthClient', { ns: 'plugin' }),
        type: FormTypeEnum.radio,
        options: [
          {
            label: t('auth.default', { ns: 'plugin' }),
            value: 'default',
          },
          {
            label: t('auth.custom', { ns: 'plugin' }),
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

  const __auth_client__ = useMemo(() => {
    if (isConfigured) {
      if (is_oauth_custom_client_enabled)
        return 'custom'
      return 'default'
    }
    else {
      if (is_system_oauth_params_exists)
        return 'default'
      return 'custom'
    }
  }, [isConfigured, is_oauth_custom_client_enabled, is_system_oauth_params_exists])

  return (
    <>
      {
        isConfigured && (
          <div className={cn('flex w-full', className)}>
            <Button
              variant={buttonVariant}
              className={cn(
                'h-8 min-w-0 flex-1 rounded-r-none px-0 py-0 hover:bg-components-button-primary-bg-hover',
                buttonLeftClassName,
              )}
              disabled={disabled}
              onClick={handleOAuth}
            >
              <div
                className="truncate"
                title={buttonText}
              >
                {buttonText}
              </div>
              {
                is_oauth_custom_client_enabled && (
                  <Badge
                    className={cn(
                      'mr-0.5 ml-1',
                      buttonVariant === 'primary' && 'border-text-primary-on-surface bg-components-badge-bg-dimm text-text-primary-on-surface',
                    )}
                  >
                    {t('auth.custom', { ns: 'plugin' })}
                  </Badge>
                )
              }
            </Button>
            <div className={cn(
              'h-4 w-px shrink-0 self-center bg-text-primary-on-surface opacity-[0.15]',
              dividerClassName,
            )}
            >
            </div>
            <Button
              variant={buttonVariant}
              aria-label={t('auth.oauthClientSettings', { ns: 'plugin' })}
              className={cn(
                'h-8 w-8 shrink-0 rounded-l-none px-0 py-0 hover:bg-components-button-primary-bg-hover',
                buttonRightClassName,
              )}
              disabled={disabled}
              onClick={() => {
                openOAuthSettings()
              }}
            >
              <span className="i-ri-equalizer-2-line h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )
      }
      {
        !isConfigured && (
          <Button
            variant={buttonVariant}
            onClick={openOAuthSettings}
            disabled={disabled}
            className="w-full"
          >
            <span className="mr-0.5 i-ri-equalizer-2-line h-4 w-4" />
            {t('auth.setupOAuth', { ns: 'plugin' })}
          </Button>
        )
      }
      {
        isOAuthSettingsMounted && (
          <OAuthClientSettings
            open={isOAuthSettingsOpen}
            onOpenChange={setIsOAuthSettingsOpen}
            pluginPayload={pluginPayload}
            onClose={() => setIsOAuthSettingsOpen(false)}
            disabled={disabled || isLoading}
            schemas={memorizedSchemas}
            onAuth={handleOAuth}
            editValues={{
              ...client_params,
              __oauth_client__: __auth_client__,
            }}
            hasOriginalClientParams={Object.keys(client_params || {}).length > 0}
            onUpdate={onUpdate}
          />
        )
      }
    </>
  )
}

export default memo(AddOAuthButton)
