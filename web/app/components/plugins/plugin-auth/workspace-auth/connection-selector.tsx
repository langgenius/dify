import type { usePluginAuth } from '../hooks/use-plugin-auth'
import type { Credential, PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import type { CredentialPermission } from '@/models/permission'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { AvatarFallback, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { memo, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { toast } from '@/app/notifications'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import ApiKeyModal from '../authorize/api-key-modal'
import OAuthClientSettings from '../authorize/oauth-client-settings'
import OAuthVisibilityDialog from '../authorize/oauth-visibility-dialog'
import { CredentialTypeEnum } from '../types'

export type ConnectionSelectorProps = {
  pluginPayload: PluginPayload
  authorization: ReturnType<typeof usePluginAuth>
  credentialId?: string
  onAuthorizationItemClick: (id: string) => void
  onDefaultCredentialChange?: (id?: string) => void
}

const ConnectionSelector = ({
  pluginPayload,
  authorization,
  credentialId,
  onAuthorizationItemClick,
  onDefaultCredentialChange,
}: ConnectionSelectorProps) => {
  const { t } = useTranslation(['common', 'plugin', 'datasetSettings', 'datasetDocuments'])
  const renderI18nObject = useRenderI18nObject()
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const {
    credentials,
    canApiKey,
    canOAuth,
    isLoading,
    notAllowCustomCredential,
    invalidPluginCredentialInfo,
  } = authorization
  const providerApi = consoleQuery.workspaces.current.toolProvider.builtin.byProvider
  const params = { provider: pluginPayload.provider }
  const apiKeySchema = useQuery(
    providerApi.credential.schema.byCredentialType.get.queryOptions({
      input: canApiKey
        ? { params: { ...params, credential_type: CredentialTypeEnum.API_KEY } }
        : skipToken,
    }),
  )
  const oauthSchema = useQuery(
    providerApi.oauth.clientSchema.get.queryOptions({
      input: canOAuth ? { params } : skipToken,
      staleTime: 0,
    }),
  )
  const [open, setOpen] = useState(false)
  const [renameCredential, setRenameCredential] = useState<Credential | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteCredential, setDeleteCredential] = useState<Credential | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [apiKeySession, setApiKeySession] = useState<{
    key: number
    credential?: Credential
  } | null>(null)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [oauthSettingsSession, setOauthSettingsSession] = useState(0)
  const [oauthSettingsOpen, setOauthSettingsOpen] = useState(false)
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const [visibility, setVisibility] = useState<CredentialPermission>(PermissionLevel.onlyMe)
  const renameInputId = useId()

  const updateCredential = useMutation(
    providerApi.update.post.mutationOptions({
      onSuccess: () => {
        invalidPluginCredentialInfo()
        setRenameOpen(false)
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
      },
    }),
  )
  const removeCredential = useMutation(
    providerApi.delete.post.mutationOptions({
      onSuccess: () => {
        invalidPluginCredentialInfo()
        setDeleteOpen(false)
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
      },
    }),
  )
  const oauthAuthorization = useMutation(
    consoleQuery.oauth.plugin.byProvider.tool.authorizationUrl.get.mutationOptions({
      onSuccess: ({ authorization_url }) => {
        if (!authorization_url) return
        openOAuthPopup(authorization_url, invalidPluginCredentialInfo)
        setVisibilityOpen(false)
      },
    }),
  )

  const defaultCredential = credentials.find((credential) => credential.is_default)
  const selectedCredential = credentialId
    ? credentials.find((credential) => credential.id === credentialId)
    : defaultCredential
  const unavailable = selectedCredential?.not_allowed_to_use || (!isLoading && !selectedCredential)
  const selectedName =
    selectedCredential?.name ||
    (isLoading
      ? t(($) => $.loading, { ns: 'common' })
      : credentialId
        ? t(($) => $['auth.authRemoved'], { ns: 'plugin' })
        : t(($) => $['auth.workspaceDefault'], { ns: 'plugin' }))

  useEffect(() => {
    onDefaultCredentialChange?.(defaultCredential?.id)
  }, [defaultCredential?.id, onDefaultCredentialChange])

  const methodLabel = (credential?: Credential) =>
    credential?.credential_type === CredentialTypeEnum.OAUTH2
      ? t(($) => $['auth.connection.oauth'], { ns: 'plugin' })
      : t(($) => $['auth.connection.apiKey'], { ns: 'plugin' })
  const subtitle = (credential?: Credential) => {
    if (!credential) return t(($) => $['auth.unavailable'], { ns: 'plugin' })
    if (credential.not_allowed_to_use) return t(($) => $['auth.unavailable'], { ns: 'plugin' })
    if (credential.credential_type === CredentialTypeEnum.API_KEY) {
      for (const field of apiKeySchema.data || []) {
        if (field.type !== FormTypeEnum.secretInput) continue
        const value = credential.credentials?.[field.name]
        // Only show a schema-identified, already-masked value; never reveal raw credentials.
        const masked = typeof value === 'string' && value.match(/^[^*•]{0,2}[*•]+([^*•]{0,4})$/)
        if (masked) return `••••${masked[1] ? ` ${masked[1]}` : ''}`
      }
    }
    return methodLabel(credential)
  }
  const groups = [
    {
      label: t(($) => $['userProfile.workspace'], { ns: 'common' }),
      items: credentials.filter(
        (credential) =>
          credential.visibility !== PermissionLevel.onlyMe && !credential.from_other_member,
      ),
    },
    {
      label: t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' }),
      items: credentials.filter(
        (credential) =>
          credential.visibility === PermissionLevel.onlyMe && !credential.from_other_member,
      ),
    },
    {
      label: t(($) => $['auth.connection.otherMembers'], { ns: 'plugin' }),
      items: credentials.filter((credential) => credential.from_other_member),
    },
  ]
  const selectCredential = (id: string) => {
    if (!canUseCredential) return
    onAuthorizationItemClick(id || (onDefaultCredentialChange ? defaultCredential?.id || '' : ''))
    setOpen(false)
  }
  const openOAuthSettings = () => {
    if (!canManageCredential || notAllowCustomCredential) return
    setOpen(false)
    setOauthSettingsSession((session) => session + 1)
    setOauthSettingsOpen(true)
  }
  const startOAuth = () => {
    if (!canManageCredential || notAllowCustomCredential || oauthSchema.isPending) return
    setOpen(false)
    if (
      oauthSchema.data?.is_system_oauth_params_exists ||
      oauthSchema.data?.is_oauth_custom_client_enabled
    ) {
      setVisibility(PermissionLevel.onlyMe)
      setVisibilityOpen(true)
    } else {
      openOAuthSettings()
    }
  }
  const oauthClient = oauthSchema.data
  const oauthClientParams = oauthClient?.client_params || {}
  const oauthFormSchemas: FormSchema[] = (oauthClient?.schema || []).map((field, index) => ({
    ...field,
    label:
      index === 0 && oauthClient?.redirect_uri ? (
        <div>
          <p className="mb-2 system-xs-regular text-text-tertiary">
            {t(($) => $['auth.clientInfo'], { ns: 'plugin' })}
          </p>
          <p className="mb-3 system-sm-regular break-all text-text-secondary">
            {oauthClient.redirect_uri}
          </p>
          {field.label ? renderI18nObject(field.label) : field.name}
        </div>
      ) : field.label ? (
        renderI18nObject(field.label)
      ) : (
        field.name
      ),
    required: !!field.required,
    default: oauthClientParams[field.name] ?? field.default,
    help: field.help ? renderI18nObject(field.help) : undefined,
    placeholder: field.placeholder ? renderI18nObject(field.placeholder) : undefined,
    scope: field.scope ?? undefined,
    url: field.url ?? undefined,
    options: field.options?.map((option) => ({ ...option, label: renderI18nObject(option.label) })),
    show_on: oauthClient?.is_system_oauth_params_exists
      ? [{ variable: '__oauth_client__', value: 'custom' }]
      : undefined,
  }))
  if (oauthClient?.is_system_oauth_params_exists) {
    oauthFormSchemas.unshift({
      name: '__oauth_client__',
      type: FormTypeEnum.radio,
      label: t(($) => $['auth.oauthClient'], { ns: 'plugin' }),
      required: false,
      options: [
        { label: t(($) => $['auth.default'], { ns: 'plugin' }), value: 'default' },
        { label: t(($) => $['auth.custom'], { ns: 'plugin' }), value: 'custom' },
      ],
    })
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex h-13 w-full cursor-pointer items-center gap-0.5 rounded-lg bg-components-input-bg-normal px-1 py-1.5 text-left hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt">
          <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden>
            <AvatarRoot
              size="xs"
              className="border-[0.5px] border-divider-regular bg-components-icon-bg-blue-soft"
            >
              <AvatarFallback size="xs" className="text-xs text-text-accent">
                {selectedName[0]?.toLocaleUpperCase()}
              </AvatarFallback>
            </AvatarRoot>
          </span>
          <span className="flex min-w-0 grow flex-col gap-0.5 px-1 py-0.75">
            {/* The connection picker discloses the complete name through its wrapping rows. */}
            <span
              className={cn(
                'truncate system-sm-regular text-components-input-text-filled',
                unavailable && 'text-text-destructive',
              )}
            >
              {selectedName}
            </span>
            <span className="truncate system-xs-regular text-text-tertiary">
              {subtitle(selectedCredential)}
            </span>
          </span>
          <span
            aria-hidden
            className="mr-1 i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary"
          />
        </PopoverTrigger>
        <PopoverContent
          placement="bottom-start"
          sideOffset={8}
          className="max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) overflow-y-auto bg-components-panel-bg-blur p-1 backdrop-blur-[5px]"
        >
          <PopoverTitle className="sr-only">
            {t(($) => $['auth.authorization'], { ns: 'plugin' })}
          </PopoverTitle>
          <div className="space-y-0.5">
            {groups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <div className="px-2 pt-2 pb-1 system-xs-regular text-text-tertiary">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((credential) => {
                      const isSelected = selectedCredential?.id === credential.id
                      const canManage =
                        canManageCredential &&
                        !credential.from_enterprise &&
                        !credential.from_other_member
                      const canEdit = canManage && !credential.not_allowed_to_use
                      const canFollowDefault =
                        credential.is_default && canUseCredential && !credential.not_allowed_to_use
                      return (
                        <div
                          key={credential.id}
                          className={cn(
                            'flex min-h-12.5 items-center rounded-lg pr-2 hover:bg-state-base-hover',
                            isSelected && 'bg-background-section-burn',
                          )}
                        >
                          <Button
                            variant="ghost"
                            aria-pressed={isSelected}
                            // Match the connection row's 8px spacing rather than a compact action label.
                            className="h-auto min-w-0 grow justify-start gap-2 p-2 text-left hover:bg-transparent"
                            disabled={!canUseCredential || credential.not_allowed_to_use}
                            onClick={() => selectCredential(credential.id)}
                          >
                            <span
                              aria-hidden
                              className="flex size-3.5 shrink-0 items-center justify-center"
                            >
                              {isSelected && (
                                <span className="i-ri-check-line size-3.5 text-text-accent" />
                              )}
                            </span>
                            <span className="flex min-w-0 grow flex-col gap-0.5">
                              <span className="system-sm-medium wrap-anywhere whitespace-normal text-components-input-text-filled">
                                {credential.name}
                              </span>
                              <span className="truncate system-xs-regular text-text-tertiary">
                                {subtitle(credential)}
                              </span>
                            </span>
                            <span className="shrink-0 system-xs-regular text-text-tertiary">
                              {methodLabel(credential)}
                            </span>
                          </Button>
                          {credential.from_other_member && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="flex shrink-0 items-center text-text-tertiary">
                                    <span aria-hidden className="i-ri-information-line size-4" />
                                  </span>
                                }
                              />
                              <TooltipContent>
                                {t(($) => $['auth.onlyAtCreationHintTooltip'], { ns: 'plugin' })}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {(canManage || canFollowDefault) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <IconButton
                                    size="xs"
                                    aria-label={t(($) => $['operation.moreActionsFor'], {
                                      ns: 'common',
                                      name: credential.name,
                                    })}
                                  >
                                    <span
                                      aria-hidden
                                      className="i-ri-more-fill size-4 text-text-tertiary"
                                    />
                                  </IconButton>
                                }
                              />
                              <DropdownMenuContent placement="bottom-end" className="min-w-40">
                                {canFollowDefault && (
                                  <DropdownMenuItem onClick={() => selectCredential('')}>
                                    {t(($) => $['auth.workspaceDefault'], { ns: 'plugin' })}
                                  </DropdownMenuItem>
                                )}
                                {canEdit &&
                                  credential.credential_type === CredentialTypeEnum.OAUTH2 && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setOpen(false)
                                        setRenameCredential(credential)
                                        setRenameValue(credential.name)
                                        setRenameOpen(true)
                                      }}
                                    >
                                      {t(($) => $['operation.rename'], { ns: 'common' })}
                                    </DropdownMenuItem>
                                  )}
                                {canEdit &&
                                  credential.credential_type === CredentialTypeEnum.API_KEY && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setOpen(false)
                                        setApiKeySession((session) => ({
                                          key: (session?.key || 0) + 1,
                                          credential,
                                        }))
                                        setApiKeyOpen(true)
                                      }}
                                    >
                                      {t(($) => $['operation.edit'], { ns: 'common' })}
                                    </DropdownMenuItem>
                                  )}
                                {canManage && (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => {
                                      setOpen(false)
                                      setDeleteCredential(credential)
                                      setDeleteOpen(true)
                                    }}
                                  >
                                    {t(($) => $['operation.delete'], { ns: 'common' })}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
          </div>
          {!notAllowCustomCredential && (
            <div className="space-y-1 px-1 pt-2 pb-0.5">
              <div className="flex gap-2">
                {canOAuth && (
                  <Button
                    className="min-w-0 flex-1"
                    disabled={!canManageCredential || oauthSchema.isPending || oauthSchema.isError}
                    onClick={startOAuth}
                  >
                    {t(($) => $['auth.addOAuth'], { ns: 'plugin' })}
                  </Button>
                )}
                {canApiKey && (
                  <Button
                    className="min-w-0 flex-1"
                    disabled={!canCreateCredential}
                    onClick={() => {
                      setOpen(false)
                      setApiKeySession((session) => ({ key: (session?.key || 0) + 1 }))
                      setApiKeyOpen(true)
                    }}
                  >
                    {t(($) => $['auth.connection.addApiKey'], { ns: 'plugin' })}
                  </Button>
                )}
              </div>
              {canOAuth && (
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={!canManageCredential || oauthSchema.isPending || oauthSchema.isError}
                  onClick={openOAuthSettings}
                >
                  <span aria-hidden className="i-ri-equalizer-2-line size-4" />
                  {t(($) => $['auth.connection.oauthClientSettings'], { ns: 'plugin' })}
                </Button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogTitle className="title-lg-semi-bold mb-4 text-text-primary">
            {t(($) => $['operation.rename'], { ns: 'common' })}
          </DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (
                !canManageCredential ||
                !renameCredential ||
                !renameValue.trim() ||
                updateCredential.isPending
              )
                return
              updateCredential.mutate({
                params,
                body: { credential_id: renameCredential.id, name: renameValue.trim() },
              })
            }}
          >
            <label
              htmlFor={renameInputId}
              className="mb-1 block system-sm-medium text-text-secondary"
            >
              {t(($) => $['auth.authorizationName'], { ns: 'plugin' })}
            </label>
            <Input
              id={renameInputId}
              value={renameValue}
              onValueChange={setRenameValue}
              disabled={updateCredential.isPending}
              required
            />
            <div className="mt-6 flex justify-end gap-2">
              <DialogClose
                render={
                  <Button disabled={updateCredential.isPending}>
                    {t(($) => $['operation.cancel'], { ns: 'common' })}
                  </Button>
                }
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!canManageCredential || !renameValue.trim()}
                loading={updateCredential.isPending}
              >
                {t(($) => $['operation.save'], { ns: 'common' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <div className="p-6 pb-0">
            <AlertDialogTitle className="title-lg-semi-bold text-text-primary">
              {t(($) => $['list.delete.title'], { ns: 'datasetDocuments' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 system-sm-regular text-text-secondary">
              {deleteCredential?.name}
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={removeCredential.isPending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={removeCredential.isPending}
              disabled={!canManageCredential}
              onClick={() => {
                if (!canManageCredential || !deleteCredential || removeCredential.isPending) return
                removeCredential.mutate({ params, body: { credential_id: deleteCredential.id } })
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {apiKeySession && (
        <ApiKeyModal
          key={apiKeySession.key}
          open={apiKeyOpen}
          onOpenChange={setApiKeyOpen}
          pluginPayload={pluginPayload}
          editValues={
            apiKeySession.credential
              ? {
                  ...apiKeySession.credential.credentials,
                  __name__: apiKeySession.credential.name,
                  __credential_id__: apiKeySession.credential.id,
                  __visibility__: apiKeySession.credential.visibility,
                }
              : undefined
          }
          disabled={apiKeySession.credential ? !canManageCredential : !canCreateCredential}
          onUpdate={invalidPluginCredentialInfo}
          onRemove={() => {
            if (!canManageCredential || !apiKeySession.credential) return
            setApiKeyOpen(false)
            setDeleteCredential(apiKeySession.credential)
            setDeleteOpen(true)
          }}
        />
      )}
      {oauthSettingsSession > 0 && (
        <OAuthClientSettings
          key={oauthSettingsSession}
          open={oauthSettingsOpen}
          onOpenChange={setOauthSettingsOpen}
          pluginPayload={pluginPayload}
          schemas={oauthFormSchemas}
          disabled={!canManageCredential || oauthSchema.isPending}
          editValues={{
            ...oauthClientParams,
            __oauth_client__:
              oauthClient?.is_oauth_custom_client_enabled ||
              !oauthClient?.is_system_oauth_params_exists
                ? 'custom'
                : 'default',
          }}
          hasOriginalClientParams={Object.keys(oauthClientParams).length > 0}
          onUpdate={() => {
            invalidPluginCredentialInfo()
            oauthSchema.refetch().catch(() => {})
          }}
          onRequestAuthorization={() => {
            setVisibility(PermissionLevel.onlyMe)
            setVisibilityOpen(true)
          }}
        />
      )}
      <OAuthVisibilityDialog
        open={visibilityOpen}
        onOpenChange={setVisibilityOpen}
        permission={visibility}
        onPermissionChange={setVisibility}
        loading={oauthAuthorization.isPending}
        onConfirm={() => {
          if (!canManageCredential || oauthAuthorization.isPending) return
          oauthAuthorization.mutate({ params, query: { visibility } })
        }}
      />
    </>
  )
}

export default memo(ConnectionSelector)
