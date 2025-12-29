'use client'
import type { FC } from 'react'
import type { AliyunConfig, ArizeConfig, DatabricksConfig, LangFuseConfig, LangSmithConfig, MLflowConfig, OpikConfig, PhoenixConfig, TencentConfig, WeaveConfig } from './type'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import Divider from '@/app/components/base/divider'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import Toast from '@/app/components/base/toast'
import { addTracingConfig, removeTracingConfig, updateTracingConfig } from '@/service/apps'
import { docURL } from './config'
import Field from './field'
import { TracingProvider } from './type'

type Props = {
  appId: string
  type: TracingProvider
  payload?: ArizeConfig | PhoenixConfig | LangSmithConfig | LangFuseConfig | OpikConfig | WeaveConfig | AliyunConfig | MLflowConfig | DatabricksConfig | TencentConfig | null
  onRemoved: () => void
  onCancel: () => void
  onSaved: (payload: ArizeConfig | PhoenixConfig | LangSmithConfig | LangFuseConfig | OpikConfig | WeaveConfig | AliyunConfig | MLflowConfig | DatabricksConfig | TencentConfig) => void
  onChosen: (provider: TracingProvider) => void
}

const I18N_PREFIX = 'tracing.configProvider'

const arizeConfigTemplate = {
  api_key: '',
  space_id: '',
  project: '',
  endpoint: '',
}

const phoenixConfigTemplate = {
  api_key: '',
  project: '',
  endpoint: '',
}

const langSmithConfigTemplate = {
  api_key: '',
  project: '',
  endpoint: '',
}

const langFuseConfigTemplate = {
  public_key: '',
  secret_key: '',
  host: '',
}

const opikConfigTemplate = {
  api_key: '',
  project: '',
  url: '',
  workspace: '',
}

const weaveConfigTemplate = {
  api_key: '',
  entity: '',
  project: '',
  endpoint: '',
  host: '',
}

const aliyunConfigTemplate = {
  app_name: '',
  license_key: '',
  endpoint: '',
}

const mlflowConfigTemplate = {
  tracking_uri: '',
  experiment_id: '',
  username: '',
  password: '',
}

const databricksConfigTemplate = {
  experiment_id: '',
  host: '',
  client_id: '',
  client_secret: '',
  personal_access_token: '',
}

const tencentConfigTemplate = {
  token: '',
  endpoint: '',
  service_name: '',
}

const ProviderConfigModal: FC<Props> = ({
  appId,
  type,
  payload,
  onRemoved,
  onCancel,
  onSaved,
  onChosen,
}) => {
  const { t } = useTranslation()
  const isEdit = !!payload
  const isAdd = !isEdit
  const [isSaving, setIsSaving] = useState(false)
  const [config, setConfig] = useState<ArizeConfig | PhoenixConfig | LangSmithConfig | LangFuseConfig | OpikConfig | WeaveConfig | AliyunConfig | MLflowConfig | DatabricksConfig | TencentConfig>((() => {
    if (isEdit)
      return payload

    if (type === TracingProvider.arize)
      return arizeConfigTemplate

    else if (type === TracingProvider.phoenix)
      return phoenixConfigTemplate

    else if (type === TracingProvider.langSmith)
      return langSmithConfigTemplate

    else if (type === TracingProvider.langfuse)
      return langFuseConfigTemplate

    else if (type === TracingProvider.opik)
      return opikConfigTemplate

    else if (type === TracingProvider.aliyun)
      return aliyunConfigTemplate

    else if (type === TracingProvider.mlflow)
      return mlflowConfigTemplate

    else if (type === TracingProvider.databricks)
      return databricksConfigTemplate

    else if (type === TracingProvider.tencent)
      return tencentConfigTemplate

    return weaveConfigTemplate
  })())
  const [isShowRemoveConfirm, {
    setTrue: showRemoveConfirm,
    setFalse: hideRemoveConfirm,
  }] = useBoolean(false)

  const handleRemove = useCallback(async () => {
    await removeTracingConfig({
      appId,
      provider: type,
    })
    Toast.notify({
      type: 'success',
      message: t('api.remove', { ns: 'common' }),
    })
    onRemoved()
    hideRemoveConfirm()
  }, [hideRemoveConfirm, appId, type, t, onRemoved])

  const handleConfigChange = useCallback((key: string) => {
    return (value: string) => {
      setConfig({
        ...config,
        [key]: value,
      })
    }
  }, [config])

  const checkValid = useCallback(() => {
    let errorMessage = ''
    if (type === TracingProvider.arize) {
      const postData = config as ArizeConfig
      if (!postData.api_key)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'API Key' })
      if (!postData.space_id)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Space ID' })
      if (!errorMessage && !postData.project)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })
    }

    if (type === TracingProvider.phoenix) {
      const postData = config as PhoenixConfig
      if (!postData.api_key)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'API Key' })
      if (!errorMessage && !postData.project)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })
    }

    if (type === TracingProvider.langSmith) {
      const postData = config as LangSmithConfig
      if (!postData.api_key)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'API Key' })
      if (!errorMessage && !postData.project)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })
    }

    if (type === TracingProvider.langfuse) {
      const postData = config as LangFuseConfig
      if (!errorMessage && !postData.secret_key)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t(`${I18N_PREFIX}.secretKey`, { ns: 'app' }) })
      if (!errorMessage && !postData.public_key)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t(`${I18N_PREFIX}.publicKey`, { ns: 'app' }) })
      if (!errorMessage && !postData.host)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Host' })
    }

    if (type === TracingProvider.opik) {
      // todo: check field validity
      // const postData = config as OpikConfig
    }

    if (type === TracingProvider.weave) {
      const postData = config as WeaveConfig
      if (!errorMessage && !postData.api_key)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'API Key' })
      if (!errorMessage && !postData.project)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })
    }

    if (type === TracingProvider.aliyun) {
      const postData = config as AliyunConfig
      if (!errorMessage && !postData.app_name)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'App Name' })
      if (!errorMessage && !postData.license_key)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'License Key' })
      if (!errorMessage && !postData.endpoint)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Endpoint' })
    }

    if (type === TracingProvider.mlflow) {
      const postData = config as MLflowConfig
      if (!errorMessage && !postData.tracking_uri)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Tracking URI' })
    }

    if (type === TracingProvider.databricks) {
      const postData = config as DatabricksConfig
      if (!errorMessage && !postData.experiment_id)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Experiment ID' })
      if (!errorMessage && !postData.host)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Host' })
    }

    if (type === TracingProvider.tencent) {
      const postData = config as TencentConfig
      if (!errorMessage && !postData.token)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Token' })
      if (!errorMessage && !postData.endpoint)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Endpoint' })
      if (!errorMessage && !postData.service_name)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: 'Service Name' })
    }

    return errorMessage
  }, [config, t, type])
  const handleSave = useCallback(async () => {
    if (isSaving)
      return
    const errorMessage = checkValid()
    if (errorMessage) {
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
      return
    }
    const action = isEdit ? updateTracingConfig : addTracingConfig
    try {
      await action({
        appId,
        body: {
          tracing_provider: type,
          tracing_config: config,
        },
      })
      Toast.notify({
        type: 'success',
        message: t('api.success', { ns: 'common' }),
      })
      onSaved(config)
      if (isAdd)
        onChosen(type)
    }
    finally {
      setIsSaving(false)
    }
  }, [appId, checkValid, config, isAdd, isEdit, isSaving, onChosen, onSaved, t, type])

  return (
    <>
      {!isShowRemoveConfirm
        ? (
            <PortalToFollowElem open>
              <PortalToFollowElemContent className="z-[60] h-full w-full">
                <div className="fixed inset-0 flex items-center justify-center bg-background-overlay">
                  <div className="mx-2 max-h-[calc(100vh-120px)] w-[640px] overflow-y-auto rounded-2xl bg-components-panel-bg shadow-xl">
                    <div className="px-8 pt-8">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="title-2xl-semi-bold text-text-primary">
                          {t(`${I18N_PREFIX}.title`, { ns: 'app' })}
                          {t(`tracing.${type}.title`, { ns: 'app' })}
                        </div>
                      </div>

                      <div className="space-y-4">
                        {type === TracingProvider.arize && (
                          <>
                            <Field
                              label="API Key"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as ArizeConfig).api_key}
                              onChange={handleConfigChange('api_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'API Key' })!}
                            />
                            <Field
                              label="Space ID"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as ArizeConfig).space_id}
                              onChange={handleConfigChange('space_id')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'Space ID' })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.project`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as ArizeConfig).project}
                              onChange={handleConfigChange('project')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })!}
                            />
                            <Field
                              label="Endpoint"
                              labelClassName="!text-sm"
                              value={(config as ArizeConfig).endpoint}
                              onChange={handleConfigChange('endpoint')}
                              placeholder="https://otlp.arize.com"
                            />
                          </>
                        )}
                        {type === TracingProvider.phoenix && (
                          <>
                            <Field
                              label="API Key"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as PhoenixConfig).api_key}
                              onChange={handleConfigChange('api_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'API Key' })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.project`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as PhoenixConfig).project}
                              onChange={handleConfigChange('project')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })!}
                            />
                            <Field
                              label="Endpoint"
                              labelClassName="!text-sm"
                              value={(config as PhoenixConfig).endpoint}
                              onChange={handleConfigChange('endpoint')}
                              placeholder="https://app.phoenix.arize.com"
                            />
                          </>
                        )}
                        {type === TracingProvider.aliyun && (
                          <>
                            <Field
                              label="License Key"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as AliyunConfig).license_key}
                              onChange={handleConfigChange('license_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'License Key' })!}
                            />
                            <Field
                              label="Endpoint"
                              labelClassName="!text-sm"
                              value={(config as AliyunConfig).endpoint}
                              onChange={handleConfigChange('endpoint')}
                              placeholder="https://tracing.arms.aliyuncs.com"
                            />
                            <Field
                              label="App Name"
                              labelClassName="!text-sm"
                              value={(config as AliyunConfig).app_name}
                              onChange={handleConfigChange('app_name')}
                            />
                          </>
                        )}
                        {type === TracingProvider.tencent && (
                          <>
                            <Field
                              label="Token"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as TencentConfig).token}
                              onChange={handleConfigChange('token')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'Token' })!}
                            />
                            <Field
                              label="Endpoint"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as TencentConfig).endpoint}
                              onChange={handleConfigChange('endpoint')}
                              placeholder="https://your-region.cls.tencentcs.com"
                            />
                            <Field
                              label="Service Name"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as TencentConfig).service_name}
                              onChange={handleConfigChange('service_name')}
                              placeholder="dify_app"
                            />
                          </>
                        )}
                        {type === TracingProvider.weave && (
                          <>
                            <Field
                              label="API Key"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as WeaveConfig).api_key}
                              onChange={handleConfigChange('api_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'API Key' })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.project`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as WeaveConfig).project}
                              onChange={handleConfigChange('project')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })!}
                            />
                            <Field
                              label="Entity"
                              labelClassName="!text-sm"
                              value={(config as WeaveConfig).entity}
                              onChange={handleConfigChange('entity')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'Entity' })!}
                            />
                            <Field
                              label="Endpoint"
                              labelClassName="!text-sm"
                              value={(config as WeaveConfig).endpoint}
                              onChange={handleConfigChange('endpoint')}
                              placeholder="https://trace.wandb.ai/"
                            />
                            <Field
                              label="Host"
                              labelClassName="!text-sm"
                              value={(config as WeaveConfig).host}
                              onChange={handleConfigChange('host')}
                              placeholder="https://api.wandb.ai"
                            />
                          </>
                        )}
                        {type === TracingProvider.langSmith && (
                          <>
                            <Field
                              label="API Key"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as LangSmithConfig).api_key}
                              onChange={handleConfigChange('api_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'API Key' })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.project`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as LangSmithConfig).project}
                              onChange={handleConfigChange('project')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })!}
                            />
                            <Field
                              label="Endpoint"
                              labelClassName="!text-sm"
                              value={(config as LangSmithConfig).endpoint}
                              onChange={handleConfigChange('endpoint')}
                              placeholder="https://api.smith.langchain.com"
                            />
                          </>
                        )}
                        {type === TracingProvider.langfuse && (
                          <>
                            <Field
                              label={t(`${I18N_PREFIX}.secretKey`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as LangFuseConfig).secret_key}
                              isRequired
                              onChange={handleConfigChange('secret_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.secretKey`, { ns: 'app' }) })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.publicKey`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as LangFuseConfig).public_key}
                              onChange={handleConfigChange('public_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.publicKey`, { ns: 'app' }) })!}
                            />
                            <Field
                              label="Host"
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as LangFuseConfig).host}
                              onChange={handleConfigChange('host')}
                              placeholder="https://cloud.langfuse.com"
                            />
                          </>
                        )}
                        {type === TracingProvider.opik && (
                          <>
                            <Field
                              label="API Key"
                              labelClassName="!text-sm"
                              value={(config as OpikConfig).api_key}
                              onChange={handleConfigChange('api_key')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: 'API Key' })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.project`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as OpikConfig).project}
                              onChange={handleConfigChange('project')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.project`, { ns: 'app' }) })!}
                            />
                            <Field
                              label="Workspace"
                              labelClassName="!text-sm"
                              value={(config as OpikConfig).workspace}
                              onChange={handleConfigChange('workspace')}
                              placeholder="default"
                            />
                            <Field
                              label="Url"
                              labelClassName="!text-sm"
                              value={(config as OpikConfig).url}
                              onChange={handleConfigChange('url')}
                              placeholder="https://www.comet.com/opik/api/"
                            />
                          </>
                        )}
                        {type === TracingProvider.mlflow && (
                          <>
                            <Field
                              label={t(`${I18N_PREFIX}.trackingUri`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as MLflowConfig).tracking_uri}
                              isRequired
                              onChange={handleConfigChange('tracking_uri')}
                              placeholder="http://localhost:5000"
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.experimentId`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              isRequired
                              value={(config as MLflowConfig).experiment_id}
                              onChange={handleConfigChange('experiment_id')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.experimentId`, { ns: 'app' }) })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.username`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as MLflowConfig).username}
                              onChange={handleConfigChange('username')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.username`, { ns: 'app' }) })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.password`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as MLflowConfig).password}
                              onChange={handleConfigChange('password')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.password`, { ns: 'app' }) })!}
                            />
                          </>
                        )}
                        {type === TracingProvider.databricks && (
                          <>
                            <Field
                              label={t(`${I18N_PREFIX}.experimentId`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as DatabricksConfig).experiment_id}
                              onChange={handleConfigChange('experiment_id')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.experimentId`, { ns: 'app' }) })!}
                              isRequired
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.databricksHost`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as DatabricksConfig).host}
                              onChange={handleConfigChange('host')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.databricksHost`, { ns: 'app' }) })!}
                              isRequired
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.clientId`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as DatabricksConfig).client_id}
                              onChange={handleConfigChange('client_id')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.clientId`, { ns: 'app' }) })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.clientSecret`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as DatabricksConfig).client_secret}
                              onChange={handleConfigChange('client_secret')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.clientSecret`, { ns: 'app' }) })!}
                            />
                            <Field
                              label={t(`${I18N_PREFIX}.personalAccessToken`, { ns: 'app' })!}
                              labelClassName="!text-sm"
                              value={(config as DatabricksConfig).personal_access_token}
                              onChange={handleConfigChange('personal_access_token')}
                              placeholder={t(`${I18N_PREFIX}.placeholder`, { ns: 'app', key: t(`${I18N_PREFIX}.personalAccessToken`, { ns: 'app' }) })!}
                            />
                          </>
                        )}
                      </div>
                      <div className="my-8 flex h-8 items-center justify-between">
                        <a
                          className="flex items-center space-x-1 text-xs font-normal leading-[18px] text-[#155EEF]"
                          target="_blank"
                          href={docURL[type]}
                        >
                          <span>{t(`${I18N_PREFIX}.viewDocsLink`, { ns: 'app', key: t(`tracing.${type}.title`, { ns: 'app' }) })}</span>
                          <LinkExternal02 className="h-3 w-3" />
                        </a>
                        <div className="flex items-center">
                          {isEdit && (
                            <>
                              <Button
                                className="h-9 text-sm font-medium text-text-secondary"
                                onClick={showRemoveConfirm}
                              >
                                <span className="text-[#D92D20]">{t('operation.remove', { ns: 'common' })}</span>
                              </Button>
                              <Divider type="vertical" className="mx-3 h-[18px]" />
                            </>
                          )}
                          <Button
                            className="mr-2 h-9 text-sm font-medium text-text-secondary"
                            onClick={onCancel}
                          >
                            {t('operation.cancel', { ns: 'common' })}
                          </Button>
                          <Button
                            className="h-9 text-sm font-medium"
                            variant="primary"
                            onClick={handleSave}
                            loading={isSaving}
                          >
                            {t(`operation.${isAdd ? 'saveAndEnable' : 'save'}`, { ns: 'common' })}
                          </Button>
                        </div>

                      </div>
                    </div>
                    <div className="border-t-[0.5px] border-divider-regular">
                      <div className="flex items-center justify-center bg-background-section-burn py-3 text-xs text-text-tertiary">
                        <Lock01 className="mr-1 h-3 w-3 text-text-tertiary" />
                        {t('modelProvider.encrypted.front', { ns: 'common' })}
                        <a
                          className="mx-1 text-primary-600"
                          target="_blank"
                          rel="noopener noreferrer"
                          href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
                        >
                          PKCS1_OAEP
                        </a>
                        {t('modelProvider.encrypted.back', { ns: 'common' })}
                      </div>
                    </div>
                  </div>
                </div>
              </PortalToFollowElemContent>
            </PortalToFollowElem>
          )
        : (
            <Confirm
              isShow
              type="warning"
              title={t(`${I18N_PREFIX}.removeConfirmTitle`, { ns: 'app', key: t(`tracing.${type}.title`, { ns: 'app' }) })!}
              content={t(`${I18N_PREFIX}.removeConfirmContent`, { ns: 'app' })}
              onConfirm={handleRemove}
              onCancel={hideRemoveConfirm}
            />
          )}
    </>
  )
}
export default React.memo(ProviderConfigModal)
