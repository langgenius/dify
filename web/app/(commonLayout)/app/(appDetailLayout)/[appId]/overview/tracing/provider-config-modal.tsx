'use client'
import type {
  TraceAppConfigResponse,
  TraceConfigPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent } from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { useMutation } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { docURL } from './config'
import Field from './field'
import { TracingProvider } from './type'

type Props = Readonly<{
  appId: string
  type: TracingProvider
  payload?: TraceAppConfigResponse['tracing_config']
  onRemoved: () => void
  onCancel: () => void
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
  onCancel,
  onSaved,
  onChosen,
}) => {
  const { t } = useTranslation(['app', 'common', 'modelProvider'])
  const isEdit = !!payload
  const [config, setConfig] = useState<TraceConfigPayload['tracing_config']>(
    () => payload ?? configTemplates[type],
  )
  const [
    isRemoveDialogOpen,
    { set: setIsRemoveDialogOpen, setTrue: showRemoveConfirm, setFalse: hideRemoveConfirm },
  ] = useBoolean(false)

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
        hideRemoveConfirm()
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

  // Defer onCancel to onOpenChangeComplete so the dialog's exit animation
  // (scale/opacity transition) can finish before the parent unmounts this modal.
  const handleConfigDialogOpenChangeComplete = useCallback(
    (open: boolean) => {
      if (!open) onCancel()
    },
    [onCancel],
  )

  return (
    <>
      {!isRemoveDialogOpen ? (
        <Dialog defaultOpen onOpenChangeComplete={handleConfigDialogOpenChangeComplete}>
          <DialogContent className="max-h-[calc(100dvh-1rem)] w-auto max-w-[calc(100vw-1rem)] overflow-visible border-none bg-transparent p-0 shadow-none">
            <div className="flex items-center justify-center">
              <div className="mx-2 max-h-[calc(100vh-120px)] w-160 overflow-y-auto rounded-2xl bg-components-panel-bg shadow-xl">
                <div className="px-8 pt-8">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="title-2xl-semi-bold text-text-primary">
                      {t(($) => $[`${I18N_PREFIX}.title`], { ns: 'app' })}
                      {t(($) => $[`tracing.${type}.title`], { ns: 'app' })}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {type === TracingProvider.arize && (
                      <>
                        <Field
                          label="API Key"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.api_key ?? ''}
                          onChange={handleConfigChange('api_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'API Key',
                          })}
                        />
                        <Field
                          label="Space ID"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.space_id ?? ''}
                          onChange={handleConfigChange('space_id')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'Space ID',
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          isRequired
                          value={config.project ?? ''}
                          onChange={handleConfigChange('project')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label="Endpoint"
                          labelClassName="text-sm!"
                          value={config.endpoint ?? ''}
                          onChange={handleConfigChange('endpoint')}
                          placeholder="https://otlp.arize.com"
                        />
                      </>
                    )}
                    {type === TracingProvider.phoenix && (
                      <>
                        <Field
                          label="API Key"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.api_key ?? ''}
                          onChange={handleConfigChange('api_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'API Key',
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          isRequired
                          value={config.project ?? ''}
                          onChange={handleConfigChange('project')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label="Endpoint"
                          labelClassName="text-sm!"
                          value={config.endpoint ?? ''}
                          onChange={handleConfigChange('endpoint')}
                          placeholder="https://app.phoenix.arize.com"
                        />
                      </>
                    )}
                    {type === TracingProvider.aliyun && (
                      <>
                        <Field
                          label="License Key"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.license_key ?? ''}
                          onChange={handleConfigChange('license_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'License Key',
                          })}
                        />
                        <Field
                          label="Endpoint"
                          labelClassName="text-sm!"
                          value={config.endpoint ?? ''}
                          onChange={handleConfigChange('endpoint')}
                          placeholder="https://tracing.arms.aliyuncs.com"
                        />
                        <Field
                          label="App Name"
                          labelClassName="text-sm!"
                          value={config.app_name ?? ''}
                          onChange={handleConfigChange('app_name')}
                        />
                      </>
                    )}
                    {type === TracingProvider.tencent && (
                      <>
                        <Field
                          label="Token"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.token ?? ''}
                          onChange={handleConfigChange('token')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'Token',
                          })}
                        />
                        <Field
                          label="Endpoint"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.endpoint ?? ''}
                          onChange={handleConfigChange('endpoint')}
                          placeholder="https://your-region.cls.tencentcs.com"
                        />
                        <Field
                          label="Service Name"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.service_name ?? ''}
                          onChange={handleConfigChange('service_name')}
                          placeholder="dify_app"
                        />
                      </>
                    )}
                    {type === TracingProvider.weave && (
                      <>
                        <Field
                          label="API Key"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.api_key ?? ''}
                          onChange={handleConfigChange('api_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'API Key',
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          isRequired
                          value={config.project ?? ''}
                          onChange={handleConfigChange('project')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label="Entity"
                          labelClassName="text-sm!"
                          value={config.entity ?? ''}
                          onChange={handleConfigChange('entity')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'Entity',
                          })}
                        />
                        <Field
                          label="Endpoint"
                          labelClassName="text-sm!"
                          value={config.endpoint ?? ''}
                          onChange={handleConfigChange('endpoint')}
                          placeholder="https://trace.wandb.ai/"
                        />
                        <Field
                          label="Host"
                          labelClassName="text-sm!"
                          value={config.host ?? ''}
                          onChange={handleConfigChange('host')}
                          placeholder="https://api.wandb.ai"
                        />
                      </>
                    )}
                    {type === TracingProvider.langSmith && (
                      <>
                        <Field
                          label="API Key"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.api_key ?? ''}
                          onChange={handleConfigChange('api_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'API Key',
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          isRequired
                          value={config.project ?? ''}
                          onChange={handleConfigChange('project')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label="Endpoint"
                          labelClassName="text-sm!"
                          value={config.endpoint ?? ''}
                          onChange={handleConfigChange('endpoint')}
                          placeholder="https://api.smith.langchain.com"
                        />
                      </>
                    )}
                    {type === TracingProvider.langfuse && (
                      <>
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.secretKey`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.secret_key ?? ''}
                          isRequired
                          onChange={handleConfigChange('secret_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.secretKey`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.publicKey`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          isRequired
                          value={config.public_key ?? ''}
                          onChange={handleConfigChange('public_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.publicKey`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label="Host"
                          labelClassName="text-sm!"
                          isRequired
                          value={config.host ?? ''}
                          onChange={handleConfigChange('host')}
                          placeholder="https://cloud.langfuse.com"
                        />
                      </>
                    )}
                    {type === TracingProvider.opik && (
                      <>
                        <Field
                          label="API Key"
                          labelClassName="text-sm!"
                          value={config.api_key ?? ''}
                          onChange={handleConfigChange('api_key')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: 'API Key',
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.project ?? ''}
                          onChange={handleConfigChange('project')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.project`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label="Workspace"
                          labelClassName="text-sm!"
                          value={config.workspace ?? ''}
                          onChange={handleConfigChange('workspace')}
                          placeholder="default"
                        />
                        <Field
                          label="Url"
                          labelClassName="text-sm!"
                          value={config.url ?? ''}
                          onChange={handleConfigChange('url')}
                          placeholder="https://www.comet.com/opik/api/"
                        />
                      </>
                    )}
                    {type === TracingProvider.mlflow && (
                      <>
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.trackingUri`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.tracking_uri ?? ''}
                          isRequired
                          onChange={handleConfigChange('tracking_uri')}
                          placeholder="http://localhost:5000"
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          isRequired
                          value={config.experiment_id ?? ''}
                          onChange={handleConfigChange('experiment_id')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.username`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.username ?? ''}
                          onChange={handleConfigChange('username')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.username`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.password`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.password ?? ''}
                          onChange={handleConfigChange('password')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.password`], { ns: 'app' }),
                          })}
                        />
                      </>
                    )}
                    {type === TracingProvider.databricks && (
                      <>
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.experiment_id ?? ''}
                          onChange={handleConfigChange('experiment_id')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.experimentId`], { ns: 'app' }),
                          })}
                          isRequired
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.databricksHost`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.host ?? ''}
                          onChange={handleConfigChange('host')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.databricksHost`], { ns: 'app' }),
                          })}
                          isRequired
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.clientId`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.client_id ?? ''}
                          onChange={handleConfigChange('client_id')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.clientId`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.clientSecret`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.client_secret ?? ''}
                          onChange={handleConfigChange('client_secret')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.clientSecret`], { ns: 'app' }),
                          })}
                        />
                        <Field
                          label={t(($) => $[`${I18N_PREFIX}.personalAccessToken`], { ns: 'app' })}
                          labelClassName="text-sm!"
                          value={config.personal_access_token ?? ''}
                          onChange={handleConfigChange('personal_access_token')}
                          placeholder={t(($) => $[`${I18N_PREFIX}.placeholder`], {
                            ns: 'app',
                            key: t(($) => $[`${I18N_PREFIX}.personalAccessToken`], { ns: 'app' }),
                          })}
                        />
                      </>
                    )}
                  </div>
                  <div className="my-8 flex h-8 items-center justify-between">
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
                      <span
                        aria-hidden
                        className="i-custom-vender-line-general-link-external-02 size-3"
                      />
                    </a>
                    <div className="flex items-center">
                      {isEdit && (
                        <>
                          <Button
                            className="h-9 text-sm font-medium text-text-secondary"
                            onClick={showRemoveConfirm}
                          >
                            <span className="text-[#D92D20]">
                              {t(($) => $['operation.remove'], { ns: 'common' })}
                            </span>
                          </Button>
                          <Separator orientation="vertical" className="mx-3 h-4.5" />
                        </>
                      )}
                      <DialogClose
                        render={
                          <Button className="mr-2 h-9 text-sm font-medium text-text-secondary" />
                        }
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
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <AlertDialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
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
              <AlertDialogConfirmButton onClick={handleRemove} loading={removeConfig.isPending}>
                {t(($) => $['operation.confirm'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
export default React.memo(ProviderConfigModal)
