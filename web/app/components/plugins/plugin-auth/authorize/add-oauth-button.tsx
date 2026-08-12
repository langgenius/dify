import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
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
import PermissionSelector from './permission-selector'

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
  renderTrigger?: (props: {
    disabled?: boolean
    isConfigured: boolean
    onClick: () => void
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
  // Pre-OAuth visibility picker — OAuth tokens are creation-only for visibility
  // (same rule as API-key credentials), so we prompt the user to choose Personal
  // or Shared before kicking off the OAuth redirect. Default to only_me since
  // OAuth tokens are usually tied to an individual account.
  //
  // Scoped to categories whose backend accepts + persists visibility on the
  // OAuth start/callback path. Trigger and model OAuth endpoints haven't been
  // wired yet, and showing the picker there would let the user pick "Only me"
  // while the credential silently defaults to all_team_members on the backend.
  const isVisibilityPickerSupported =
    pluginPayload.category === AuthCategory.tool ||
    pluginPayload.category === AuthCategory.datasource
  const [isVisibilityModalOpen, setIsVisibilityModalOpen] = useState(false)
  const [pendingVisibility, setPendingVisibility] = useState<CredentialPermission>(
    PermissionLevel.onlyMe,
  )
  const { mutateAsync: getPluginOAuthUrl } = useGetPluginOAuthUrlHook(pluginPayload)
  const { data, isLoading } = useGetPluginOAuthClientSchemaHook(pluginPayload)
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
    const { authorization_url } = await getPluginOAuthUrl(
      isVisibilityPickerSupported ? { visibility: pendingVisibility } : undefined,
    )

    if (authorization_url) {
      openOAuthPopup(authorization_url, () => onUpdate?.())
    }
  }, [getPluginOAuthUrl, onUpdate, pendingVisibility, isVisibilityPickerSupported])
  // Click handler for the main OAuth button.
  // - Categories without backend visibility support (trigger / model): skip the
  //   picker entirely and kick off OAuth directly, so the UI never promises a
  //   visibility the backend won't honor.
  // - Supported category + system OAuth (isConfigured): show a small pre-OAuth
  //   visibility picker, then kick off the popup on confirm.
  // - Supported category + custom OAuth (!isConfigured): go straight to
  //   OAuthClientSettings; the visibility picker lives inline in that modal so
  //   users only see one dialog for the whole "set up + authorize" step.
  const openVisibilityModal = useCallback(() => {
    if (!isVisibilityPickerSupported) {
      if (isConfigured) handleOAuth()
      else openOAuthSettings()
      return
    }
    if (isConfigured) setIsVisibilityModalOpen(true)
    else openOAuthSettings()
  }, [isConfigured, isVisibilityPickerSupported, openOAuthSettings, handleOAuth])
  const handleVisibilityConfirm = useCallback(() => {
    setIsVisibilityModalOpen(false)
    handleOAuth()
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
                  <ActionButton
                    aria-label={t(($) => $['operation.copy'], { ns: 'common' })}
                    className="shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(redirect_uri || '')
                    }}
                  >
                    <span aria-hidden className="i-ri-clipboard-line size-4" />
                  </ActionButton>
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

  return (
    <>
      {renderTrigger?.({
        disabled,
        isConfigured,
        onClick: openVisibilityModal,
      })}
      {!renderTrigger && isConfigured && (
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
          <Button
            variant={buttonVariant}
            aria-label={t(($) => $['auth.oauthClientSettings'], { ns: 'plugin' })}
            className={cn(
              'size-8 shrink-0 rounded-l-none p-0 hover:bg-components-button-primary-bg-hover',
              buttonRightClassName,
            )}
            disabled={disabled}
            onClick={() => {
              openOAuthSettings()
            }}
          >
            <span className="i-ri-equalizer-2-line size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      {!renderTrigger && !isConfigured && (
        <Button
          variant={buttonVariant}
          onClick={openVisibilityModal}
          disabled={disabled}
          className="w-full"
        >
          <span className="i-ri-equalizer-2-line size-4" />
          {t(($) => $['auth.setupOAuth'], { ns: 'plugin' })}
        </Button>
      )}
      {isOAuthSettingsMounted && (
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
          visibility={isVisibilityPickerSupported ? pendingVisibility : undefined}
          onVisibilityChange={isVisibilityPickerSupported ? setPendingVisibility : undefined}
        />
      )}
      <Dialog open={isVisibilityModalOpen} onOpenChange={setIsVisibilityModalOpen}>
        <DialogContent className="w-[480px]! max-w-[calc(100vw-2rem)]! p-0!">
          <div className="flex flex-col">
            <div className="relative shrink-0 p-6 pr-14 pb-3">
              <DialogTitle className="title-2xl-semi-bold text-text-primary">
                {t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}
              </DialogTitle>
              <DialogCloseButton className="top-5 right-5 size-8 rounded-lg" />
            </div>
            <div className="px-6 py-3">
              <PermissionSelector permission={pendingVisibility} onChange={setPendingVisibility} />
            </div>
            <div className="flex shrink-0 justify-end p-6 pt-5">
              <Button onClick={() => setIsVisibilityModalOpen(false)}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button variant="primary" className="ml-2" onClick={handleVisibilityConfirm}>
                {t(($) => $['auth.saveAndAuth'], { ns: 'plugin' })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default memo(AddOAuthButton)
