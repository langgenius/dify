import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { PermissionLevel } from '@/models/permission'
import {
  useGetPluginOAuthClientSchemaHook,
  useGetPluginOAuthUrlHook,
} from '../hooks/use-credential'
import { AuthCategory } from '../types'
import OAuthClientSettings from './oauth-client-settings'
import OAuthVisibilityDialog from './oauth-visibility-dialog'

export type AddOAuthButtonProps = {
  pluginPayload: PluginPayload
  buttonVariant?: NonNullable<ButtonProps['variant']>
  buttonText?: string
  className?: string
  buttonLeftClassName?: string
  buttonRightClassName?: string
  dividerClassName?: string
  disabled?: boolean
  onUpdate?: () => void
  renderTrigger?: (props: {
    disabled?: boolean
    isConfigured: boolean
    onClick: () => void
    trigger: React.ReactNode
  }) => React.ReactNode
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
  renderTrigger,
  oAuthData,
}: AddOAuthButtonProps) => {
  const { t } = useTranslation()
  const renderI18nObject = useRenderI18nObject()
  const [isOAuthSettingsOpen, setIsOAuthSettingsOpen] = useState(false)
  const [isOAuthSettingsMounted, setIsOAuthSettingsMounted] = useState(false)
  // Only expose the picker where the OAuth callback persists the selection.
  const isVisibilityPickerSupported =
    pluginPayload.category === AuthCategory.tool ||
    pluginPayload.category === AuthCategory.datasource
  const [isVisibilityModalOpen, setIsVisibilityModalOpen] = useState(false)
  const [pendingVisibility, setPendingVisibility] = useState<CredentialPermission>(
    PermissionLevel.onlyMe,
  )
  const { mutateAsync: getPluginOAuthUrl, isPending: isGettingOAuthUrl } =
    useGetPluginOAuthUrlHook(pluginPayload)
  const { data, isLoading } = useGetPluginOAuthClientSchemaHook(pluginPayload, !oAuthData)
  const mergedOAuthData = useMemo<OAuthData>(() => {
    if (oAuthData) return oAuthData

    return data || {}
  }, [oAuthData, data])
  const {
    schema = [],
    is_oauth_custom_client_enabled = false,
    is_system_oauth_params_exists = false,
    client_params = {},
    redirect_uri,
  } = mergedOAuthData
  const isConfigured = is_system_oauth_params_exists || is_oauth_custom_client_enabled
  const openOAuthSettings = useCallback(() => {
    setIsOAuthSettingsMounted(true)
    setIsOAuthSettingsOpen(true)
  }, [])
  const handleOAuth = useCallback(async () => {
    try {
      const { authorization_url } = await getPluginOAuthUrl(
        isVisibilityPickerSupported ? { visibility: pendingVisibility } : undefined,
      )

      if (!authorization_url) return false

      openOAuthPopup(authorization_url, () => onUpdate?.())
      return true
    } catch {
      // The request layer surfaces the error. Keep the current UI state so the
      // user can retry without losing their visibility selection.
      return false
    }
  }, [getPluginOAuthUrl, onUpdate, pendingVisibility, isVisibilityPickerSupported])
  // Providers without a usable OAuth client first open settings. Once those
  // settings are saved, authorization continues through the same visibility
  // dialog used by configured providers.
  const openVisibilityModal = useCallback(() => {
    if (!isVisibilityPickerSupported) {
      if (isConfigured) void handleOAuth()
      else openOAuthSettings()
      return
    }
    if (isConfigured) {
      setPendingVisibility(PermissionLevel.onlyMe)
      setIsVisibilityModalOpen(true)
    } else {
      openOAuthSettings()
    }
  }, [isConfigured, isVisibilityPickerSupported, openOAuthSettings, handleOAuth])
  const handleAuthorizationRequest = useCallback(async () => {
    if (!isVisibilityPickerSupported) {
      await handleOAuth()
      return
    }

    setPendingVisibility(PermissionLevel.onlyMe)
    setIsVisibilityModalOpen(true)
  }, [handleOAuth, isVisibilityPickerSupported])
  const handleVisibilityConfirm = useCallback(async () => {
    const didOpenOAuthPopup = await handleOAuth()
    if (didOpenOAuthPopup) setIsVisibilityModalOpen(false)
  }, [handleOAuth])

  const renderCustomLabel = useCallback(
    (item: FormSchema) => {
      return (
        <div className="w-full">
          <div className="mb-4 flex rounded-xl bg-background-section-burn p-4">
            <div className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg">
              <span className="i-ri-information-2-fill size-5 text-text-accent" />
            </div>
            <div className="w-0 grow">
              <div className="mb-1.5 system-sm-regular">
                {t(($) => $['auth.clientInfo'], { ns: 'plugin' })}
              </div>
              {redirect_uri && (
                <div className="flex w-full py-0.5 system-sm-medium">
                  <div className="w-0 grow wrap-break-word break-all">{redirect_uri}</div>
                  <IconButton
                    aria-label={t(($) => $['operation.copy'], { ns: 'common' })}
                    className="shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(redirect_uri || '')
                    }}
                  >
                    <span aria-hidden className="i-ri-clipboard-line size-4" />
                  </IconButton>
                </div>
              )}
            </div>
          </div>
          <div className="flex h-6 items-center system-sm-medium text-text-secondary">
            {renderI18nObject(item.label as Record<string, string>)}
            {item.required && <span className="ml-1 text-text-destructive-secondary">*</span>}
          </div>
        </div>
      )
    },
    [t, redirect_uri, renderI18nObject],
  )
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
        label: t(($) => $['auth.oauthClient'], { ns: 'plugin' }),
        type: FormTypeEnum.radio,
        options: [
          {
            label: t(($) => $['auth.default'], { ns: 'plugin' }),
            value: 'default',
          },
          {
            label: t(($) => $['auth.custom'], { ns: 'plugin' }),
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
          if (client_params) item.default = client_params[item.name] || item.default
        }
      })
    }

    return result
  }, [
    schema,
    renderCustomLabel,
    t,
    is_system_oauth_params_exists,
    is_oauth_custom_client_enabled,
    client_params,
  ])

  const __auth_client__ = useMemo(() => {
    if (isConfigured) {
      if (is_oauth_custom_client_enabled) return 'custom'
      return 'default'
    } else {
      if (is_system_oauth_params_exists) return 'default'
      return 'custom'
    }
  }, [isConfigured, is_oauth_custom_client_enabled, is_system_oauth_params_exists])

  const trigger = isConfigured ? (
    <div className={cn('flex w-full', className)}>
      <Button
        variant={buttonVariant}
        className={cn(
          'h-8 min-w-0 flex-1 rounded-r-none p-0 hover:bg-components-button-primary-bg-hover',
          buttonLeftClassName,
        )}
        disabled={disabled}
        onClick={openVisibilityModal}
      >
        <div className="truncate">{buttonText}</div>
        {is_oauth_custom_client_enabled && (
          <Badge
            className={cn(
              'mr-0.5',
              buttonVariant === 'primary' &&
                'border-text-primary-on-surface bg-components-badge-bg-dimm text-text-primary-on-surface',
            )}
          >
            {t(($) => $['auth.custom'], { ns: 'plugin' })}
          </Badge>
        )}
      </Button>
      <div
        className={cn(
          'h-4 w-px shrink-0 self-center bg-text-primary-on-surface opacity-[0.15]',
          dividerClassName,
        )}
      ></div>
      <IconButton
        variant={buttonVariant}
        aria-label={t(($) => $['auth.oauthClientSettings'], { ns: 'plugin' })}
        size="lg"
        className={cn(
          'shrink-0 rounded-l-none hover:bg-components-button-primary-bg-hover',
          buttonRightClassName,
        )}
        disabled={disabled}
        onClick={openOAuthSettings}
      >
        <span className="i-ri-equalizer-2-line size-4" aria-hidden="true" />
      </IconButton>
    </div>
  ) : (
    <Button
      variant={buttonVariant}
      onClick={openVisibilityModal}
      disabled={disabled}
      className="w-full"
    >
      <span className="i-ri-equalizer-2-line size-4" />
      {t(($) => $['auth.setupOAuth'], { ns: 'plugin' })}
    </Button>
  )

  return (
    <>
      {renderTrigger
        ? renderTrigger({
            disabled,
            isConfigured,
            onClick: openVisibilityModal,
            trigger,
          })
        : trigger}
      {isOAuthSettingsMounted && (
        <OAuthClientSettings
          open={isOAuthSettingsOpen}
          onOpenChange={setIsOAuthSettingsOpen}
          pluginPayload={pluginPayload}
          onClose={() => setIsOAuthSettingsOpen(false)}
          disabled={disabled || isLoading}
          schemas={memorizedSchemas}
          onRequestAuthorization={handleAuthorizationRequest}
          editValues={{
            ...client_params,
            __oauth_client__: __auth_client__,
          }}
          hasOriginalClientParams={Object.keys(client_params || {}).length > 0}
          onUpdate={onUpdate}
        />
      )}
      <OAuthVisibilityDialog
        open={isVisibilityModalOpen}
        onOpenChange={setIsVisibilityModalOpen}
        permission={pendingVisibility}
        onPermissionChange={setPendingVisibility}
        onConfirm={handleVisibilityConfirm}
        loading={isGettingOAuthUrl}
      />
    </>
  )
}

export default memo(AddOAuthButton)
