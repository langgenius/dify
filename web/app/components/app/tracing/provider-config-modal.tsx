'use client'
import type {
  TraceAppConfigResponse,
  TraceConfigPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { RefObject } from 'react'
import type { ConfigurableTracingProvider } from './providers'
import type { TracingResource } from './resource'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Separator } from '@langgenius/dify-ui/separator'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import { consoleQuery } from '@/service/console'
import { tracingProviders } from './providers'

type ProviderConfigModalProps = {
  resource: TracingResource
  type: ConfigurableTracingProvider
  payload?: TraceAppConfigResponse['tracing_config']
  /** Whether traces currently go to this provider, so removing it turns tracing off. */
  inUse: boolean
  onRemoved: () => void
  firstInputRef: RefObject<HTMLInputElement | null>
  onSaved: () => void
}

const I18N_PREFIX = 'tracing.configProvider'

export function ProviderConfigModal({
  resource,
  type,
  payload,
  inUse,
  onRemoved,
  firstInputRef,
  onSaved,
}: ProviderConfigModalProps) {
  const { t } = useTranslation(['app', 'common', 'modelProvider'])
  const createAppConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.post.mutationOptions({ context: { silent: true } }),
  )
  const createAgentConfig = useMutation(
    consoleQuery.agent.byAgentId.traceConfig.post.mutationOptions({ context: { silent: true } }),
  )
  const updateAppConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.patch.mutationOptions({ context: { silent: true } }),
  )
  const updateAgentConfig = useMutation(
    consoleQuery.agent.byAgentId.traceConfig.patch.mutationOptions({ context: { silent: true } }),
  )
  const removeAppConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.delete.mutationOptions({ context: { silent: true } }),
  )
  const removeAgentConfig = useMutation(
    consoleQuery.agent.byAgentId.traceConfig.delete.mutationOptions({ context: { silent: true } }),
  )
  const createConfig = resource.kind === 'agent' ? createAgentConfig : createAppConfig
  const updateConfig = resource.kind === 'agent' ? updateAgentConfig : updateAppConfig
  const removeConfig = resource.kind === 'agent' ? removeAgentConfig : removeAppConfig
  const isEdit = !!payload
  const saveError = createConfig.error ?? updateConfig.error
  const pending = createConfig.isPending || updateConfig.isPending || removeConfig.isPending
  const handleRemove = () => {
    if (pending) return
    const query = { tracing_provider: type }
    if (resource.kind === 'agent')
      removeAgentConfig.mutate(
        { params: { agent_id: resource.agentId }, query },
        { onSuccess: onRemoved },
      )
    else
      removeAppConfig.mutate(
        { params: { app_id: resource.appId }, query },
        { onSuccess: onRemoved },
      )
  }
  const handleSave = (values: TraceConfigPayload['tracing_config']) => {
    if (pending) return
    if (isEdit) createConfig.reset()
    else updateConfig.reset()
    const config: TraceConfigPayload['tracing_config'] = {}
    for (const [key, value] of Object.entries(values))
      config[key] = value === '' && payload?.[key] === null ? null : value
    const body: TraceConfigPayload = { tracing_provider: type, tracing_config: config }
    if (!isEdit) body.activate = true
    if (resource.kind === 'agent')
      (isEdit ? updateAgentConfig : createAgentConfig).mutate(
        { params: { agent_id: resource.agentId }, body },
        { onSuccess: onSaved },
      )
    else
      (isEdit ? updateAppConfig : createAppConfig).mutate(
        { params: { app_id: resource.appId }, body },
        { onSuccess: onSaved },
      )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $[`${I18N_PREFIX}.title`], { ns: 'app' })}
          {t(($) => $[`tracing.${type}.title`], { ns: 'app' })}
        </DialogTitle>
        <DialogCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={pending}
        />
      </DialogHeader>

      <Form<TraceConfigPayload['tracing_config']> className="contents" onFormSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            {type === 'arize' && (
              <>
                <Field disabled={pending} name="api_key">
                  <FieldLabel>
                    API Key
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    ref={firstInputRef}
                    required
                    defaultValue={payload?.api_key ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'API Key',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="space_id">
                  <FieldLabel>
                    Space ID
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    required
                    defaultValue={payload?.space_id ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'Space ID',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="project">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    required
                    defaultValue={payload?.project ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="endpoint">
                  <FieldLabel>Endpoint</FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    defaultValue={payload?.endpoint ?? ''}
                    placeholder="https://otlp.arize.com"
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'phoenix' && (
              <>
                <Field disabled={pending} name="api_key">
                  <FieldLabel>
                    API Key
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    ref={firstInputRef}
                    required
                    defaultValue={payload?.api_key ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'API Key',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="project">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    required
                    defaultValue={payload?.project ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="endpoint">
                  <FieldLabel>Endpoint</FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    defaultValue={payload?.endpoint ?? ''}
                    placeholder="https://app.phoenix.arize.com"
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'aliyun' && (
              <>
                <Field disabled={pending} name="license_key">
                  <FieldLabel>
                    License Key
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    pattern=".*\S.*"
                    ref={firstInputRef}
                    required
                    defaultValue={payload?.license_key ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'License Key',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="endpoint">
                  <FieldLabel>
                    Endpoint
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    required
                    defaultValue={payload?.endpoint ?? ''}
                    placeholder="https://tracing.arms.aliyuncs.com"
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="app_name">
                  <FieldLabel>
                    App Name
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input required defaultValue={payload?.app_name ?? ''} />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'tencent' && (
              <>
                <Field disabled={pending} name="token">
                  <FieldLabel>
                    Token
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    pattern=".*\S.*"
                    ref={firstInputRef}
                    required
                    defaultValue={payload?.token ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'Token',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="endpoint">
                  <FieldLabel>
                    Endpoint
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    required
                    defaultValue={payload?.endpoint ?? ''}
                    placeholder="https://your-region.cls.tencentcs.com"
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="service_name">
                  <FieldLabel>
                    Service Name
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    required
                    defaultValue={payload?.service_name ?? ''}
                    placeholder="dify_app"
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'weave' && (
              <>
                <Field disabled={pending} name="api_key">
                  <FieldLabel>
                    API Key
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    ref={firstInputRef}
                    required
                    defaultValue={payload?.api_key ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'API Key',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="project">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    required
                    defaultValue={payload?.project ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="entity">
                  <FieldLabel>Entity</FieldLabel>
                  <Input
                    defaultValue={payload?.entity ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'Entity',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="endpoint">
                  <FieldLabel>Endpoint</FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]://.+"
                    defaultValue={payload?.endpoint ?? ''}
                    placeholder="https://trace.wandb.ai/"
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="host">
                  <FieldLabel>Host</FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    defaultValue={payload?.host ?? ''}
                    placeholder="https://api.wandb.ai"
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'langsmith' && (
              <>
                <Field disabled={pending} name="api_key">
                  <FieldLabel>
                    API Key
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    ref={firstInputRef}
                    required
                    defaultValue={payload?.api_key ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'API Key',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="project">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    required
                    defaultValue={payload?.project ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="endpoint">
                  <FieldLabel>Endpoint</FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]://.+"
                    defaultValue={payload?.endpoint ?? ''}
                    placeholder="https://api.smith.langchain.com"
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'langfuse' && (
              <>
                <Field disabled={pending} name="secret_key">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.secretKey`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    ref={firstInputRef}
                    defaultValue={payload?.secret_key ?? ''}
                    required
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.secretKey`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="public_key">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.publicKey`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    required
                    defaultValue={payload?.public_key ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.publicKey`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="host">
                  <FieldLabel>
                    Host
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    required
                    defaultValue={payload?.host ?? ''}
                    placeholder="https://cloud.langfuse.com"
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'opik' && (
              <>
                <Field disabled={pending} name="api_key">
                  <FieldLabel>API Key</FieldLabel>
                  <Input
                    ref={firstInputRef}
                    defaultValue={payload?.api_key ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: 'API Key',
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="project">
                  <FieldLabel>{t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}</FieldLabel>
                  <Input
                    defaultValue={payload?.project ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="workspace">
                  <FieldLabel>Workspace</FieldLabel>
                  <Input defaultValue={payload?.workspace ?? ''} placeholder="default" />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="url">
                  <FieldLabel>Url</FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.*/api/"
                    defaultValue={payload?.url ?? ''}
                    placeholder="https://www.comet.com/opik/api/"
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'mlflow' && (
              <>
                <Field disabled={pending} name="tracking_uri">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.trackingUri`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    ref={firstInputRef}
                    defaultValue={payload?.tracking_uri ?? ''}
                    required
                    placeholder="http://localhost:5000"
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="experiment_id">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    inputMode="numeric"
                    pattern="\s*[0-9]+\s*"
                    required
                    defaultValue={payload?.experiment_id ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="username">
                  <FieldLabel>{t(($) => $[`${I18N_PREFIX}.username`], { ns: 'app' })}</FieldLabel>
                  <Input
                    defaultValue={payload?.username ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.username`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="password">
                  <FieldLabel>{t(($) => $[`${I18N_PREFIX}.password`], { ns: 'app' })}</FieldLabel>
                  <Input
                    defaultValue={payload?.password ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.password`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
              </>
            )}
            {type === 'databricks' && (
              <>
                <Field disabled={pending} name="experiment_id">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    inputMode="numeric"
                    pattern="\s*[0-9]+\s*"
                    ref={firstInputRef}
                    defaultValue={payload?.experiment_id ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' }),
                    })}
                    required
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="host">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.databricksHost`], { ns: 'app' })}
                    <span aria-hidden className="text-text-destructive">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    type="url"
                    pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"
                    defaultValue={payload?.host ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.databricksHost`], { ns: 'app' }),
                    })}
                    required
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="client_id">
                  <FieldLabel>{t(($) => $[`${I18N_PREFIX}.clientId`], { ns: 'app' })}</FieldLabel>
                  <Input
                    defaultValue={payload?.client_id ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.clientId`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="client_secret">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.clientSecret`], { ns: 'app' })}
                  </FieldLabel>
                  <Input
                    defaultValue={payload?.client_secret ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.clientSecret`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
                <Field disabled={pending} name="personal_access_token">
                  <FieldLabel>
                    {t(($) => $[`${I18N_PREFIX}.personalAccessToken`], { ns: 'app' })}
                  </FieldLabel>
                  <Input
                    defaultValue={payload?.personal_access_token ?? ''}
                    placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                      ns: 'app',
                      key: t(($) => $[`${I18N_PREFIX}.personalAccessToken`], { ns: 'app' }),
                    })}
                  />
                  <FieldError />
                </Field>
              </>
            )}
          </div>
          {saveError && (
            <p role="alert" className="mt-4 system-sm-regular text-text-destructive">
              {saveError.message}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <a
            className="me-auto flex items-center space-x-1 text-xs leading-4.5 font-normal text-primary-600"
            target="_blank"
            href={tracingProviders[type].docUrl}
          >
            <span>
              {t(($) => $[`${I18N_PREFIX}.viewDocsLink`], {
                ns: 'app',
                key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }),
              })}
            </span>
            <span aria-hidden className="i-custom-vender-line-general-link-external-02 size-3" />
          </a>
          {isEdit && (
            <>
              <AlertDialog
                onOpenChange={(open, details) => {
                  if (!open && removeConfig.isPending) details.cancel()
                }}
              >
                <AlertDialogTrigger render={<Button tone="destructive" disabled={pending} />}>
                  {t(($) => $['operation.remove'], { ns: 'common' })}
                </AlertDialogTrigger>
                <AlertDialogContent backdropProps={{ forceRender: true }}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t(($) => $[`${I18N_PREFIX}.removeConfirmTitle`], {
                        ns: 'app',
                        key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }),
                      })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(
                        ($) =>
                          $[
                            `${I18N_PREFIX}.${inUse ? 'removeConfirmContentInUse' : 'removeConfirmContentNotInUse'}`
                          ],
                        { ns: 'app', key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }) },
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {removeConfig.error && (
                    <p role="alert" className="px-6 system-sm-regular text-text-destructive">
                      {removeConfig.error.message}
                    </p>
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancelButton disabled={removeConfig.isPending}>
                      {t(($) => $['operation.cancel'], { ns: 'common' })}
                    </AlertDialogCancelButton>
                    <AlertDialogConfirmButton onClick={handleRemove} loading={pending}>
                      {t(($) => $['operation.remove'], { ns: 'common' })}
                    </AlertDialogConfirmButton>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Separator orientation="vertical" className="mx-1 h-4.5" />
            </>
          )}
          <DialogClose disabled={pending} render={<Button />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button variant="primary" type="submit" loading={pending}>
            {t(($) => $[`operation.${isEdit ? 'save' : 'saveAndEnable'}`], {
              ns: 'common',
            })}
          </Button>
        </DialogFooter>
        <EncryptedBottom
          front={t(($) => $['modelProvider.encrypted.front'], { ns: 'modelProvider' })}
          back={t(($) => $['modelProvider.encrypted.back'], { ns: 'modelProvider' })}
        />
      </Form>
    </>
  )
}
