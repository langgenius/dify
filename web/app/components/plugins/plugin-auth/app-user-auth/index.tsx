import type { PluginPayload } from '../types'
import type { AppUserAuthDraft } from './draft'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset } from '@langgenius/dify-ui/fieldset'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import OAuthClientSettings from '../authorize/oauth-client-settings'
import { useOAuthClient } from '../hooks/use-oauth-client'
import ConnectionSelector from '../workspace-auth/connection-selector'
import { createAppUserAuthDraft, validateAppUserAuth } from './draft'
import { createMockTestConnectionDraft } from './test-connection/model'
import { useMockTestConnectionSource } from './test-connection/use-mock-test-connection-source'

type AppUserAuthProps = {
  pluginPayload: PluginPayload
  active?: boolean
  notAllowCustomCredential?: boolean
  onUpdate?: () => void
  canOAuth?: boolean
  canApiKey?: boolean
  providerName?: string
  value?: AppUserAuthDraft
  onChange?: (draft: AppUserAuthDraft) => void
}

const AppUserAuth = ({
  pluginPayload,
  active = true,
  notAllowCustomCredential,
  onUpdate,
  canOAuth = true,
  canApiKey = true,
  providerName,
  value,
  onChange,
}: AppUserAuthProps) => {
  const { t } = useTranslation(['plugin'])
  const { canManageCredential } = useCredentialPermissions()
  const oauthClient = useOAuthClient(pluginPayload, canOAuth && active)
  const descriptionLabelId = useId()
  const descriptionCountId = useId()
  const oauthDescriptionId = useId()
  const apiKeyDescriptionId = useId()
  const methodsErrorId = useId()
  const oauthClientErrorId = useId()
  const testConnectionLabelId = useId()
  // Standalone previews own their draft; workflow callers share it with the canvas.
  const [localDraft, setLocalDraft] = useState(() =>
    createAppUserAuthDraft({ canOAuth, canApiKey }),
  )
  const draft = value ?? localDraft
  const client = oauthClient.clientType ? { type: oauthClient.clientType } : undefined
  const errors = validateAppUserAuth({ ...draft, client })
  const { oauthEnabled, apiKeyEnabled, description } = draft
  const oauthDisabled =
    !canManageCredential ||
    !!notAllowCustomCredential ||
    oauthClient.query.isPending ||
    oauthClient.query.isError
  // The canvas validates the UI draft. Mirror only the provider's configured
  // client type; its parameters and secrets remain in the shared query/form.
  useEffect(() => {
    if (
      !value ||
      !canOAuth ||
      !oauthClient.query.isSuccess ||
      draft.client?.type === oauthClient.clientType
    )
      return
    const nextDraft = {
      ...draft,
      client: oauthClient.clientType ? { type: oauthClient.clientType } : undefined,
    }
    onChange?.(nextDraft)
  }, [canOAuth, oauthClient.query.isSuccess, oauthClient.clientType, draft, value, onChange])
  const testConnection =
    draft.testConnection ??
    createMockTestConnectionDraft({
      canOAuth,
      canApiKey,
    })
  const updateDraft = (updates: Partial<AppUserAuthDraft>) => {
    const nextDraft = { ...draft, client, ...updates }
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
  const testConnectionSource = useMockTestConnectionSource({
    pluginPayload,
    active,
    value: testConnection,
    canOAuth,
    canApiKey,
    providerName,
    onChange: (testConnection) => updateDraft({ testConnection }),
    onOAuthClientSettings: openClientDialog,
    oauthDisabled,
  })

  return (
    <div className="flex flex-col gap-4">
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
            <div className="space-y-2 pl-7">
              <p id={oauthDescriptionId} className="body-xs-regular text-text-tertiary">
                {client && providerName
                  ? t(($) => $['auth.appUser.oauthDescriptionWithProvider'], {
                      ns: 'plugin',
                      provider: providerName,
                    })
                  : t(($) => $['auth.appUser.oauthDescription'], { ns: 'plugin' })}
              </p>
              {oauthEnabled &&
                (client ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 w-full justify-between gap-0 rounded-lg bg-components-input-bg-normal p-0 system-sm-regular text-text-primary hover:bg-components-input-bg-hover"
                    onClick={openClientDialog}
                    disabled={oauthDisabled}
                    aria-describedby={errors.oauthClient ? oauthClientErrorId : undefined}
                  >
                    <span className="min-w-0 px-2 wrap-anywhere">
                      {client.type === 'default'
                        ? t(($) => $['auth.appUser.defaultClient'], { ns: 'plugin' })
                        : t(($) => $['auth.appUser.customClient'], { ns: 'plugin' })}
                    </span>
                    <span className="flex h-full shrink-0 items-center border-l border-components-panel-bg px-2">
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
                    aria-describedby={errors.oauthClient ? oauthClientErrorId : undefined}
                  >
                    {t(($) => $['auth.common.configureClient'], { ns: 'plugin' })}
                  </Button>
                ))}
              {oauthEnabled && errors.oauthClient && (
                <p
                  id={oauthClientErrorId}
                  role="alert"
                  className="py-0.5 body-xs-regular text-text-destructive"
                >
                  {t(($) => $['auth.appUser.setupClient'], { ns: 'plugin' })}
                </p>
              )}
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
              <p id={apiKeyDescriptionId} className="pl-7 body-xs-regular text-text-tertiary">
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
      <section aria-labelledby={testConnectionLabelId} className="flex flex-col gap-2">
        <div className="space-y-1">
          <h4
            id={testConnectionLabelId}
            className="flex min-h-6 items-center system-xs-medium-uppercase text-text-secondary"
          >
            {t(($) => $['auth.appUser.testConnection'], { ns: 'plugin' })}
          </h4>
          <p className="body-xs-regular text-text-tertiary">
            {t(($) => $['auth.appUser.testConnectionDescription'], { ns: 'plugin' })}
          </p>
        </div>
        <ConnectionSelector dataSource={testConnectionSource} />
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
          editValues={oauthClient.editValues}
          redirectUri={oauthClient.redirectUri}
          hasOriginalClientParams={oauthClient.hasOriginalClientParams}
          disabled={oauthDisabled}
          open={clientDialogOpen}
          onOpenChange={setClientDialogOpen}
          onUpdate={() => {
            onUpdate?.()
            oauthClient.query.refetch().catch(() => {})
          }}
          onRequestAuthorization={testConnectionSource.addOAuth}
        />
      )}
    </div>
  )
}

export default AppUserAuth
