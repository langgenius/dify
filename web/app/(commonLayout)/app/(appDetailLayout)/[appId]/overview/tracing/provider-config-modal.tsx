'use client'
import type {
  TraceAppConfigResponse,
  TraceConfigPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FC, RefObject } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { DialogClose, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Separator } from '@langgenius/dify-ui/separator'
import { useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { docURL } from './config'
import { TracingProvider } from './type'

type Props = Readonly<{
  appId: string
  type: TracingProvider
  payload?: TraceAppConfigResponse['tracing_config']
  onRemoved: () => void
  firstInputRef: RefObject<HTMLInputElement | null>
  onSaved: () => void
  onChosen: (provider: TracingProvider) => void
}>

const I18N_PREFIX = 'tracing.configProvider'

const configTemplates = {
  [TracingProvider.arize]: {
    api_key: '',
    space_id: '',
    project: '',
    endpoint: '',
  },
  [TracingProvider.phoenix]: {
    api_key: '',
    project: '',
    endpoint: '',
  },
  [TracingProvider.langSmith]: {
    api_key: '',
    project: '',
    endpoint: '',
  },
  [TracingProvider.langfuse]: {
    public_key: '',
    secret_key: '',
    host: '',
  },
  [TracingProvider.opik]: {
    api_key: '',
    project: '',
    url: '',
    workspace: '',
  },
  [TracingProvider.weave]: {
    api_key: '',
    entity: '',
    project: '',
    endpoint: '',
    host: '',
  },
  [TracingProvider.aliyun]: {
    app_name: '',
    license_key: '',
    endpoint: '',
  },
  [TracingProvider.mlflow]: {
    tracking_uri: '',
    experiment_id: '',
    username: '',
    password: '',
  },
  [TracingProvider.databricks]: {
    experiment_id: '',
    host: '',
    client_id: '',
    client_secret: '',
    personal_access_token: '',
  },
  [TracingProvider.tencent]: {
    token: '',
    endpoint: '',
    service_name: '',
  },
} satisfies Record<TracingProvider, TraceConfigPayload['tracing_config']>

type ConfigField = {
  [Provider in TracingProvider]: keyof (typeof configTemplates)[Provider]
}[TracingProvider]

const ProviderConfigModal: FC<Props> = ({
  appId,
  type,
  payload,
  onRemoved,
  firstInputRef,
  onSaved,
  onChosen,
}) => {
  const { t } = useTranslation(['app', 'common', 'modelProvider'])
  const isEdit = !!payload
  const [config, setConfig] = useState<TraceConfigPayload['tracing_config']>(
    () => payload ?? configTemplates[type],
  )

  const handleSaved = () => {
    toast(
      t(($) => $['api.success'], { ns: 'common' }),
      { type: 'success' },
    )
    onSaved()
  }
  const createConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.post.mutationOptions({
      onSuccess: () => {
        handleSaved()
        onChosen(type)
      },
    }),
  )
  const updateConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.patch.mutationOptions({
      onSuccess: handleSaved,
    }),
  )
  const removeConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.delete.mutationOptions({
      onSuccess: () => {
        toast(
          t(($) => $['api.remove'], { ns: 'common' }),
          { type: 'success' },
        )
        onRemoved()
      },
    }),
  )
  const isSaving = createConfig.isPending || updateConfig.isPending

  const handleRemove = () => {
    removeConfig.mutate({
      params: { app_id: appId },
      query: { tracing_provider: type },
    })
  }

  const handleConfigChange = useCallback((key: ConfigField) => {
    return (value: string) => {
      setConfig((current) => ({
        ...current,
        [key]: value,
      }))
    }
  }, [])

  const checkValid = useCallback(() => {
    let errorMessage = ''
    if (type === TracingProvider.arize) {
      if (!config.api_key)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'API Key' })
      if (!config.space_id)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'Space ID' })
      if (!errorMessage && !config.project)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
        })
    }

    if (type === TracingProvider.phoenix) {
      if (!config.api_key)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'API Key' })
      if (!errorMessage && !config.project)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
        })
    }

    if (type === TracingProvider.langSmith) {
      if (!config.api_key)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'API Key' })
      if (!errorMessage && !config.project)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
        })
    }

    if (type === TracingProvider.langfuse) {
      if (!errorMessage && !config.secret_key)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $[`${I18N_PREFIX}.secretKey`], { ns: 'app' }),
        })
      if (!errorMessage && !config.public_key)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $[`${I18N_PREFIX}.publicKey`], { ns: 'app' }),
        })
      if (!errorMessage && !config.host)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'Host' })
    }

    if (type === TracingProvider.weave) {
      if (!errorMessage && !config.api_key)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'API Key' })
      if (!errorMessage && !config.project)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
        })
    }

    if (type === TracingProvider.aliyun) {
      if (!errorMessage && !config.app_name)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'App Name' })
      if (!errorMessage && !config.license_key)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'License Key' })
      if (!errorMessage && !config.endpoint)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'Endpoint' })
    }

    if (type === TracingProvider.mlflow) {
      if (!errorMessage && !config.tracking_uri)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: 'Tracking URI',
        })
    }

    if (type === TracingProvider.databricks) {
      if (!errorMessage && !config.experiment_id)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: 'Experiment ID',
        })
      if (!errorMessage && !config.host)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'Host' })
    }

    if (type === TracingProvider.tencent) {
      if (!errorMessage && !config.token)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'Token' })
      if (!errorMessage && !config.endpoint)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: 'Endpoint' })
      if (!errorMessage && !config.service_name)
        errorMessage = t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: 'Service Name',
        })
    }

    return errorMessage
  }, [config, t, type])
  const handleSave = () => {
    if (isSaving) return
    const errorMessage = checkValid()
    if (errorMessage) {
      toast(errorMessage, { type: 'error' })
      return
    }
    const mutation = isEdit ? updateConfig : createConfig
    mutation.mutate({
      params: { app_id: appId },
      body: { tracing_provider: type, tracing_config: config },
    })
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 px-8 pt-8 pb-4">
        <DialogTitle className="min-w-0 flex-1 title-2xl-semi-bold text-text-primary">
          {t(($) => $[`${I18N_PREFIX}.title`], { ns: 'app' })}
          {t(($) => $[`tracing.${type}.title`], { ns: 'app' })}
        </DialogTitle>
        <DialogClose
          render={
            <IconButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} size="lg">
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      </div>

      <div className="px-8 pb-8">
        <div className="space-y-4">
          {type === TracingProvider.arize && (
            <>
              <Field>
                <FieldLabel>
                  API Key
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  required
                  value={config.api_key ?? ''}
                  onValueChange={handleConfigChange('api_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'API Key',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  Space ID
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.space_id ?? ''}
                  onValueChange={handleConfigChange('space_id')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'Space ID',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.project ?? ''}
                  onValueChange={handleConfigChange('project')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>Endpoint</FieldLabel>
                <Input
                  value={config.endpoint ?? ''}
                  onValueChange={handleConfigChange('endpoint')}
                  placeholder="https://otlp.arize.com"
                />
              </Field>
            </>
          )}
          {type === TracingProvider.phoenix && (
            <>
              <Field>
                <FieldLabel>
                  API Key
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  required
                  value={config.api_key ?? ''}
                  onValueChange={handleConfigChange('api_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'API Key',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.project ?? ''}
                  onValueChange={handleConfigChange('project')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>Endpoint</FieldLabel>
                <Input
                  value={config.endpoint ?? ''}
                  onValueChange={handleConfigChange('endpoint')}
                  placeholder="https://app.phoenix.arize.com"
                />
              </Field>
            </>
          )}
          {type === TracingProvider.aliyun && (
            <>
              <Field>
                <FieldLabel>
                  License Key
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  required
                  value={config.license_key ?? ''}
                  onValueChange={handleConfigChange('license_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'License Key',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>Endpoint</FieldLabel>
                <Input
                  value={config.endpoint ?? ''}
                  onValueChange={handleConfigChange('endpoint')}
                  placeholder="https://tracing.arms.aliyuncs.com"
                />
              </Field>
              <Field>
                <FieldLabel>App Name</FieldLabel>
                <Input
                  value={config.app_name ?? ''}
                  onValueChange={handleConfigChange('app_name')}
                />
              </Field>
            </>
          )}
          {type === TracingProvider.tencent && (
            <>
              <Field>
                <FieldLabel>
                  Token
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  required
                  value={config.token ?? ''}
                  onValueChange={handleConfigChange('token')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'Token',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  Endpoint
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.endpoint ?? ''}
                  onValueChange={handleConfigChange('endpoint')}
                  placeholder="https://your-region.cls.tencentcs.com"
                />
              </Field>
              <Field>
                <FieldLabel>
                  Service Name
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.service_name ?? ''}
                  onValueChange={handleConfigChange('service_name')}
                  placeholder="dify_app"
                />
              </Field>
            </>
          )}
          {type === TracingProvider.weave && (
            <>
              <Field>
                <FieldLabel>
                  API Key
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  required
                  value={config.api_key ?? ''}
                  onValueChange={handleConfigChange('api_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'API Key',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.project ?? ''}
                  onValueChange={handleConfigChange('project')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>Entity</FieldLabel>
                <Input
                  value={config.entity ?? ''}
                  onValueChange={handleConfigChange('entity')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'Entity',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>Endpoint</FieldLabel>
                <Input
                  value={config.endpoint ?? ''}
                  onValueChange={handleConfigChange('endpoint')}
                  placeholder="https://trace.wandb.ai/"
                />
              </Field>
              <Field>
                <FieldLabel>Host</FieldLabel>
                <Input
                  value={config.host ?? ''}
                  onValueChange={handleConfigChange('host')}
                  placeholder="https://api.wandb.ai"
                />
              </Field>
            </>
          )}
          {type === TracingProvider.langSmith && (
            <>
              <Field>
                <FieldLabel>
                  API Key
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  required
                  value={config.api_key ?? ''}
                  onValueChange={handleConfigChange('api_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'API Key',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.project ?? ''}
                  onValueChange={handleConfigChange('project')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>Endpoint</FieldLabel>
                <Input
                  value={config.endpoint ?? ''}
                  onValueChange={handleConfigChange('endpoint')}
                  placeholder="https://api.smith.langchain.com"
                />
              </Field>
            </>
          )}
          {type === TracingProvider.langfuse && (
            <>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.secretKey`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  value={config.secret_key ?? ''}
                  required
                  onValueChange={handleConfigChange('secret_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.secretKey`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.publicKey`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.public_key ?? ''}
                  onValueChange={handleConfigChange('public_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.publicKey`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  Host
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.host ?? ''}
                  onValueChange={handleConfigChange('host')}
                  placeholder="https://cloud.langfuse.com"
                />
              </Field>
            </>
          )}
          {type === TracingProvider.opik && (
            <>
              <Field>
                <FieldLabel>API Key</FieldLabel>
                <Input
                  ref={firstInputRef}

                  value={config.api_key ?? ''}
                  onValueChange={handleConfigChange('api_key')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: 'API Key',
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>{t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}</FieldLabel>
                <Input
                  value={config.project ?? ''}
                  onValueChange={handleConfigChange('project')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>Workspace</FieldLabel>
                <Input
                  value={config.workspace ?? ''}
                  onValueChange={handleConfigChange('workspace')}
                  placeholder="default"
                />
              </Field>
              <Field>
                <FieldLabel>Url</FieldLabel>
                <Input
                  value={config.url ?? ''}
                  onValueChange={handleConfigChange('url')}
                  placeholder="https://www.comet.com/opik/api/"
                />
              </Field>
            </>
          )}
          {type === TracingProvider.mlflow && (
            <>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.trackingUri`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  value={config.tracking_uri ?? ''}
                  required
                  onValueChange={handleConfigChange('tracking_uri')}
                  placeholder="http://localhost:5000"
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  required
                  value={config.experiment_id ?? ''}
                  onValueChange={handleConfigChange('experiment_id')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>{t(($) => $[`${I18N_PREFIX}.username`], { ns: 'app' })}</FieldLabel>
                <Input
                  value={config.username ?? ''}
                  onValueChange={handleConfigChange('username')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.username`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>{t(($) => $[`${I18N_PREFIX}.password`], { ns: 'app' })}</FieldLabel>
                <Input
                  value={config.password ?? ''}
                  onValueChange={handleConfigChange('password')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.password`], { ns: 'app' }),
                  })}
                />
              </Field>
            </>
          )}
          {type === TracingProvider.databricks && (
            <>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  ref={firstInputRef}

                  value={config.experiment_id ?? ''}
                  onValueChange={handleConfigChange('experiment_id')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' }),
                  })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.databricksHost`], { ns: 'app' })}
                  <span aria-hidden className="text-text-destructive">
                    *
                  </span>
                </FieldLabel>
                <Input
                  value={config.host ?? ''}
                  onValueChange={handleConfigChange('host')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.databricksHost`], { ns: 'app' }),
                  })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>{t(($) => $[`${I18N_PREFIX}.clientId`], { ns: 'app' })}</FieldLabel>
                <Input
                  value={config.client_id ?? ''}
                  onValueChange={handleConfigChange('client_id')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.clientId`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>{t(($) => $[`${I18N_PREFIX}.clientSecret`], { ns: 'app' })}</FieldLabel>
                <Input
                  value={config.client_secret ?? ''}
                  onValueChange={handleConfigChange('client_secret')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.clientSecret`], { ns: 'app' }),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  {t(($) => $[`${I18N_PREFIX}.personalAccessToken`], { ns: 'app' })}
                </FieldLabel>
                <Input
                  value={config.personal_access_token ?? ''}
                  onValueChange={handleConfigChange('personal_access_token')}
                  placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                    ns: 'app',
                    key: t(($) => $[`${I18N_PREFIX}.personalAccessToken`], { ns: 'app' }),
                  })}
                />
              </Field>
            </>
          )}
        </div>
        <div className="mt-8 flex items-center justify-between gap-4">
          <a
            className="flex items-center space-x-1 text-xs leading-4.5 font-normal text-primary-600"
            target="_blank"
            href={docURL[type]}
          >
            <span>
              {t(($) => $[`${I18N_PREFIX}.viewDocsLink`], {
                ns: 'app',
                key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }),
              })}
            </span>
            <span aria-hidden className="i-custom-vender-line-general-link-external-02 size-3" />
          </a>
          <div className="flex items-center">
            {isEdit && (
              <>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button className="h-9 text-sm font-medium" tone="destructive" />}
                  >
                    {t(($) => $['operation.remove'], { ns: 'common' })}
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                      <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                        {t(($) => $[`${I18N_PREFIX}.removeConfirmTitle`], {
                          ns: 'app',
                          key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }),
                        })}
                      </AlertDialogTitle>
                      <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                        {t(($) => $[`${I18N_PREFIX}.removeConfirmContent`], { ns: 'app' })}
                      </AlertDialogDescription>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancelButton>
                        {t(($) => $['operation.cancel'], { ns: 'common' })}
                      </AlertDialogCancelButton>
                      <AlertDialogConfirmButton
                        onClick={handleRemove}
                        loading={removeConfig.isPending}
                      >
                        {t(($) => $['operation.confirm'], { ns: 'common' })}
                      </AlertDialogConfirmButton>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Separator orientation="vertical" className="mx-3 h-4.5" />
              </>
            )}
            <DialogClose
              render={<Button className="mr-2 h-9 text-sm font-medium text-text-secondary" />}
            >
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button
              className="h-9 text-sm font-medium"
              variant="primary"
              onClick={handleSave}
              loading={isSaving}
            >
              {t(($) => $[`operation.${isEdit ? 'save' : 'saveAndEnable'}`], {
                ns: 'common',
              })}
            </Button>
          </div>
        </div>
      </div>
      <div className="border-t-[0.5px] border-divider-regular">
        <div className="flex items-center justify-center bg-background-section-burn py-3 text-xs text-text-tertiary">
          <span
            aria-hidden
            className="mr-1 i-custom-vender-solid-security-lock-01 size-3 text-text-tertiary"
          />
          {t(($) => $['modelProvider.encrypted.front'], { ns: 'modelProvider' })}
          <a
            className="mx-1 text-primary-600"
            target="_blank"
            rel="noopener noreferrer"
            href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
          >
            PKCS1_OAEP
          </a>
          {t(($) => $['modelProvider.encrypted.back'], { ns: 'modelProvider' })}
        </div>
      </div>
    </>
  )
}
export default React.memo(ProviderConfigModal)
