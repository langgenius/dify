import type { usePluginAuth } from '../hooks/use-plugin-auth'
import type { PluginPayload } from '../types'
import type { AppUserAuthDraft } from './draft'
import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset } from '@langgenius/dify-ui/fieldset'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import OAuthClientSettings from '../authorize/oauth-client-settings'
import OAuthVisibilityDialog from '../authorize/oauth-visibility-dialog'
import { useOAuthClient } from '../hooks/use-oauth-client'
import { CredentialTypeEnum } from '../types'
import WorkspaceConnectionSelector from '../workspace-auth/workspace-connection-selector'
import { createAppUserAuthDraft, validateAppUserAuth } from './draft'

type AppUserAuthProps = {
  pluginPayload: PluginPayload
  authorization: ReturnType<typeof usePluginAuth>
  active?: boolean
  providerName?: string
  value?: AppUserAuthDraft
  onChange?: (draft: AppUserAuthDraft) => void
}

const AppUserAuth = ({
  pluginPayload,
  authorization,
  active = true,
  providerName,
  value,
  onChange,
}: AppUserAuthProps) => {
  const { t } = useTranslation(['plugin'])
  const { canManageCredential } = useCredentialPermissions()
  const canOAuth = !!authorization.canOAuth
  const canApiKey = !!authorization.canApiKey
  const oauthClient = useOAuthClient(pluginPayload, canOAuth && active)
  const descriptionLabelId = useId()
  const descriptionCountId = useId()
  const oauthDescriptionId = useId()
  const apiKeyDescriptionId = useId()
  const methodsErrorId = useId()
  const oauthClientErrorId = useId()
  const testConnectionLabelId = useId()
  const methodSectionLabelId = useId()
  // Standalone previews own their draft; workflow callers share it with the canvas.
  const [localDraft, setLocalDraft] = useState(() =>
    createAppUserAuthDraft({ canOAuth, canApiKey }),
  )
  const draft = value ?? localDraft
  const [clientWasRemoved, setClientWasRemoved] = useState(false)
  const client =
    draft.client ??
    (!clientWasRemoved && oauthClient.clientType ? { type: oauthClient.clientType } : undefined)
  const oauthOnly = canOAuth && !canApiKey
  const apiKeyOnly = canApiKey && !canOAuth
  const oauthEnabled = canOAuth && (oauthOnly || draft.oauthEnabled)
  const apiKeyEnabled = canApiKey && (apiKeyOnly || draft.apiKeyEnabled)
  const errors = validateAppUserAuth({ ...draft, oauthEnabled, apiKeyEnabled, client })
  const showOAuthClientError = !oauthOnly && oauthEnabled && errors.oauthClient
  const { description } = draft
  const oauthDisabled =
    !canManageCredential ||
    authorization.notAllowCustomCredential ||
    oauthClient.query.isPending ||
    oauthClient.query.isError
  // Only initialize missing client metadata for the active form. Persisted node
  // choices must survive background workspace client refreshes.
  useEffect(() => {
    if (!active || !value) return
    const syncClient =
      !clientWasRemoved &&
      oauthEnabled &&
      !draft.client &&
      !!oauthClient.clientType &&
      oauthClient.query.isSuccess
    if (
      draft.oauthEnabled === oauthEnabled &&
      draft.apiKeyEnabled === apiKeyEnabled &&
      (!syncClient || draft.client?.type === oauthClient.clientType)
    )
      return
    const nextDraft = {
      ...draft,
      oauthEnabled,
      apiKeyEnabled,
      ...(syncClient
        ? { client: oauthClient.clientType ? { type: oauthClient.clientType } : undefined }
        : {}),
    }
    onChange?.(nextDraft)
  }, [
    canOAuth,
    active,
    clientWasRemoved,
    oauthEnabled,
    apiKeyEnabled,
    oauthClient.query.isSuccess,
    oauthClient.clientType,
    draft,
    value,
    onChange,
  ])
  const updateDraft = (updates: Partial<AppUserAuthDraft>) => {
    if (!active) return
    const nextDraft = { ...draft, oauthEnabled, apiKeyEnabled, client, ...updates }
    if (!value) setLocalDraft(nextDraft)
    onChange?.(nextDraft)
  }
  const [clientDialogSession, setClientDialogSession] = useState(0)
  const [clientDialogOpen, setClientDialogOpen] = useState(false)
  const openClientDialog = () => {
    if (oauthDisabled) return
    setClientDialogSession((session) => session + 1)
    setClientDialogOpen(true)
  }
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const [visibility, setVisibility] = useState<CredentialPermission>(PermissionLevel.onlyMe)
  const oauthAuthorization = useMutation(
    consoleQuery.oauth.plugin.byProvider.tool.authorizationUrl.get.mutationOptions({
      onSuccess: ({ authorization_url }) => {
        if (!authorization_url) return
        openOAuthPopup(authorization_url, authorization.invalidPluginCredentialInfo)
        setVisibilityOpen(false)
      },
    }),
  )
  const handleClientTypeChange = (type: 'default' | 'custom' | undefined) => {
    if (!active) return
    setClientWasRemoved(type === undefined)
    updateDraft({ client: type ? { type } : undefined })
  }
  const testCredentials = authorization.credentials.filter((credential) =>
    credential.credential_type === CredentialTypeEnum.OAUTH2 ? oauthEnabled : apiKeyEnabled,
  )
  const selectedTestCredential = testCredentials.find(
    (credential) => credential.id === draft.testCredentialId,
  )
  const testCredentialUsesDisabledMethod =
    !selectedTestCredential &&
    authorization.credentials.some((credential) => credential.id === draft.testCredentialId)

  const oauthClientControl =
    oauthEnabled &&
    (client ? (
      <Button
        type="button"
        variant="ghost"
        className="h-8 w-full justify-between gap-0 rounded-lg bg-components-input-bg-normal p-0 system-sm-regular text-text-primary hover:bg-components-input-bg-hover"
        onClick={openClientDialog}
        disabled={oauthDisabled}
        aria-describedby={showOAuthClientError ? oauthClientErrorId : undefined}
      >
        <span className="min-w-0 px-2 wrap-anywhere">
          {client.type === 'default'
            ? t(($) => $['auth.appUser.defaultClient'], { ns: 'plugin' })
            : t(($) => $['auth.appUser.customClient'], { ns: 'plugin' })}
        </span>
        <span className="flex h-full shrink-0 items-center border-s border-components-panel-bg px-2">
          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
        </span>
      </Button>
    ) : (
      <Button
        type="button"
        variant="primary"
        className="h-8 w-full"
        onClick={openClientDialog}
        disabled={oauthDisabled}
        aria-describedby={showOAuthClientError ? oauthClientErrorId : undefined}
      >
        {t(($) => $['auth.common.configureClient'], { ns: 'plugin' })}
      </Button>
    ))
  const oauthClientError = showOAuthClientError && (
    <p
      id={oauthClientErrorId}
      role="alert"
      className="py-0.5 body-xs-regular text-text-destructive"
    >
      {t(($) => $['auth.appUser.setupClient'], { ns: 'plugin' })}
    </p>
  )

  return (
    <div className="flex flex-col gap-4">
      {oauthOnly ? (
        <section aria-labelledby={methodSectionLabelId} className="flex flex-col gap-1">
          <h4
            id={methodSectionLabelId}
            className="flex min-h-6 items-center system-xs-medium-uppercase text-text-secondary"
          >
            {t(($) => $['auth.oauthClient'], { ns: 'plugin' })}
          </h4>
          {oauthClientControl}
          <p className="py-0.5 body-xs-regular text-text-tertiary">
            {t(($) => $['auth.appUser.oauthClientDescription'], { ns: 'plugin' })}
          </p>
        </section>
      ) : apiKeyOnly ? (
        <section aria-labelledby={methodSectionLabelId} className="flex flex-col gap-1">
          <h4
            id={methodSectionLabelId}
            className="flex min-h-6 items-center system-xs-medium-uppercase text-text-secondary"
          >
            {t(($) => $['auth.appUser.userAuthentication'], { ns: 'plugin' })}
          </h4>
          <div className="flex flex-col gap-1 rounded-lg bg-components-input-bg-normal p-3">
            <div className="flex min-h-6 items-center gap-1">
              <span className="system-sm-medium text-text-secondary">
                {t(($) => $['auth.connection.apiKey'], { ns: 'plugin' })}
              </span>
              <span className="system-xs-regular text-text-warning-secondary">
                {t(($) => $['auth.common.required'], { ns: 'plugin' })}
              </span>
            </div>
            <p className="body-xs-regular text-text-tertiary">
              {t(($) => $['auth.appUser.apiKeyRequiredDescription'], { ns: 'plugin' })}
            </p>
          </div>
        </section>
      ) : (
        <Fieldset
          aria-label={t(($) => $['auth.authorization'], { ns: 'plugin' })}
          aria-describedby={errors.methods ? methodsErrorId : undefined}
          className="space-y-3"
        >
          {canOAuth && (
            <Field className="gap-1">
              <FieldLabel className="flex min-h-6 items-center gap-3 system-sm-medium text-text-secondary">
                <Checkbox
                  checked={oauthEnabled}
                  onCheckedChange={(checked) => updateDraft({ oauthEnabled: checked })}
                  aria-invalid={errors.methods || undefined}
                  aria-describedby={[oauthDescriptionId, errors.methods && methodsErrorId]
                    .filter(Boolean)
                    .join(' ')}
                />
                {t(($) => $['auth.appUser.oauth'], { ns: 'plugin' })}
              </FieldLabel>
              <div className="space-y-2 ps-7">
                <p id={oauthDescriptionId} className="body-xs-regular text-text-tertiary">
                  {client && providerName
                    ? t(($) => $['auth.appUser.oauthDescriptionWithProvider'], {
                        ns: 'plugin',
                        provider: providerName,
                      })
                    : t(($) => $['auth.appUser.oauthDescription'], { ns: 'plugin' })}
                </p>
                {oauthClientControl}
                {oauthClientError}
              </div>
            </Field>
          )}
          {canApiKey && (
            <Field className="gap-1">
              <FieldLabel className="flex min-h-6 items-center gap-3 system-sm-medium text-text-secondary">
                <Checkbox
                  checked={apiKeyEnabled}
                  onCheckedChange={(checked) => updateDraft({ apiKeyEnabled: checked })}
                  aria-invalid={errors.methods || undefined}
                  aria-describedby={
                    [apiKeyEnabled && apiKeyDescriptionId, errors.methods && methodsErrorId]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                />
                {t(($) => $['auth.connection.apiKey'], { ns: 'plugin' })}
              </FieldLabel>
              {apiKeyEnabled && (
                <p id={apiKeyDescriptionId} className="ps-7 body-xs-regular text-text-tertiary">
                  {t(($) => $['auth.appUser.apiKeyDescription'], { ns: 'plugin' })}
                </p>
              )}
            </Field>
          )}
          {errors.methods && (
            <p
              id={methodsErrorId}
              role="alert"
              className="py-0.5 body-xs-regular text-text-destructive"
            >
              {t(($) => $['auth.appUser.selectMethod'], { ns: 'plugin' })}
            </p>
          )}
        </Fieldset>
      )}
      <section aria-labelledby={testConnectionLabelId} className="flex flex-col gap-2">
        <div className="space-y-1">
          <h4
            id={testConnectionLabelId}
            className="flex min-h-6 items-center system-xs-medium-uppercase text-text-secondary"
          >
            {t(($) => $['auth.appUser.testConnection'], { ns: 'plugin' })}
          </h4>
          <p className="body-xs-regular text-text-tertiary">
            {oauthOnly
              ? providerName
                ? t(($) => $['auth.appUser.testConnectionOAuthDescriptionWithProvider'], {
                    ns: 'plugin',
                    provider: providerName,
                  })
                : t(($) => $['auth.appUser.testConnectionOAuthDescription'], { ns: 'plugin' })
              : apiKeyOnly
                ? t(($) => $['auth.appUser.testConnectionApiKeyDescription'], { ns: 'plugin' })
                : t(($) => $['auth.appUser.testConnectionDescription'], { ns: 'plugin' })}
          </p>
        </div>
        <WorkspaceConnectionSelector
          pluginPayload={pluginPayload}
          authorization={{
            ...authorization,
            credentials: testCredentials,
            canOAuth: oauthEnabled,
            canApiKey: apiKeyEnabled,
          }}
          active={active}
          disabled={!oauthEnabled && !apiKeyEnabled}
          useWorkspaceDefault={false}
          placeholder={t(($) => $['auth.appUser.testConnection'], { ns: 'plugin' })}
          credentialId={
            testCredentialUsesDisabledMethod ? undefined : (draft.testCredentialId ?? undefined)
          }
          providerName={providerName}
          onAuthorizationItemClick={(testCredentialId) => updateDraft({ testCredentialId })}
          onClientTypeChange={handleClientTypeChange}
        />
      </section>
      <Field
        name="appUserConnectionDescription"
        invalid={errors.description}
        validationMode="onChange"
      >
        <div className="flex min-h-6 items-center gap-0.5">
          <FieldLabel
            id={descriptionLabelId}
            className="flex items-center gap-1 system-sm-medium text-text-secondary"
          >
            {t(($) => $['auth.appUser.connectionDescription'], { ns: 'plugin' })}
            <span aria-hidden className="text-text-destructive-secondary">
              *
            </span>
          </FieldLabel>
          <Infotip>
            <InfotipTrigger aria-labelledby={descriptionLabelId} className="size-4" />
            <InfotipContent>
              {t(($) => $['auth.appUser.connectionDescriptionHint'], { ns: 'plugin' })}
            </InfotipContent>
          </Infotip>
        </div>
        <InputGroup>
          <InputGroupInput
            value={description}
            onValueChange={(value) => updateDraft({ description: value.slice(0, 50) })}
            required
            maxLength={50}
            aria-describedby={descriptionCountId}
            placeholder={t(($) => $['auth.appUser.connectionDescriptionPlaceholder'], {
              ns: 'plugin',
            })}
          />
          <InputGroupAddon
            align="inline-end"
            id={descriptionCountId}
            className="text-text-tertiary"
          >
            {description.length}/50
          </InputGroupAddon>
        </InputGroup>
        <FieldError match={errors.description} role="alert">
          {t(($) => $['auth.appUser.enterDescription'], { ns: 'plugin' })}
        </FieldError>
      </Field>
      {clientDialogSession > 0 && (
        <OAuthClientSettings
          key={clientDialogSession}
          pluginPayload={pluginPayload}
          schemas={oauthClient.schemas}
          editValues={{ ...oauthClient.editValues, __oauth_client__: client?.type ?? 'custom' }}
          redirectUri={oauthClient.redirectUri}
          hasOriginalClientParams={oauthClient.hasOriginalClientParams}
          disabled={oauthDisabled}
          open={clientDialogOpen}
          onOpenChange={setClientDialogOpen}
          onUpdate={() => {
            authorization.invalidPluginCredentialInfo()
            oauthClient.query.refetch().catch(() => {})
          }}
          onClientTypeChange={handleClientTypeChange}
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
          if (!active || !canManageCredential || oauthAuthorization.isPending) return
          oauthAuthorization.mutate({
            params: { provider: pluginPayload.provider },
            query: { visibility },
          })
        }}
      />
    </div>
  )
}

export default AppUserAuth
