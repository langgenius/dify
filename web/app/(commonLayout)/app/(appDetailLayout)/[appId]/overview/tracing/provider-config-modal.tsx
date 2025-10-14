'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Field from './field'
import type { AliyunConfig, ArizeConfig, LangFuseConfig, LangSmithConfig, OpikConfig, PhoenixConfig, TencentConfig, WeaveConfig } from './type'
import { TracingProvider } from './type'
import { docURL } from './config'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Button from '@/app/components/base/button'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import Confirm from '@/app/components/base/confirm'
import { addTracingConfig, removeTracingConfig, updateTracingConfig } from '@/service/apps'
import Toast from '@/app/components/base/toast'
import Divider from '@/app/components/base/divider'

type Props = {
  appId: string
  type: TracingProvider
  payload?: ArizeConfig | PhoenixConfig | LangSmithConfig | LangFuseConfig | OpikConfig | WeaveConfig | AliyunConfig | TencentConfig | null
  onRemoved: () => void
  onCancel: () => void
  onSaved: (payload: ArizeConfig | PhoenixConfig | LangSmithConfig | LangFuseConfig | OpikConfig | WeaveConfig | AliyunConfig | TencentConfig) => void
  onChosen: (provider: TracingProvider) => void
}

const I18N_PREFIX = 'app.tracing.configProvider'

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
  const [config, setConfig] = useState<ArizeConfig | PhoenixConfig | LangSmithConfig | LangFuseConfig | OpikConfig | WeaveConfig | AliyunConfig | TencentConfig>((() => {
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
      message: t('common.api.remove'),
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
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'API Key' })
      if (!postData.space_id)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'Space ID' })
      if (!errorMessage && !postData.project)
        errorMessage = t('common.errorMsg.fieldRequired', { field: t(`${I18N_PREFIX}.project`) })
    }

    if (type === TracingProvider.phoenix) {
      const postData = config as PhoenixConfig
      if (!postData.api_key)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'API Key' })
      if (!errorMessage && !postData.project)
        errorMessage = t('common.errorMsg.fieldRequired', { field: t(`${I18N_PREFIX}.project`) })
    }

    if (type === TracingProvider.langSmith) {
      const postData = config as LangSmithConfig
      if (!postData.api_key)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'API Key' })
      if (!errorMessage && !postData.project)
        errorMessage = t('common.errorMsg.fieldRequired', { field: t(`${I18N_PREFIX}.project`) })
    }

    if (type === TracingProvider.langfuse) {
      const postData = config as LangFuseConfig
      if (!errorMessage && !postData.secret_key)
        errorMessage = t('common.errorMsg.fieldRequired', { field: t(`${I18N_PREFIX}.secretKey`) })
      if (!errorMessage && !postData.public_key)
        errorMessage = t('common.errorMsg.fieldRequired', { field: t(`${I18N_PREFIX}.publicKey`) })
      if (!errorMessage && !postData.host)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'Host' })
    }

    if (type === TracingProvider.opik) {
      // todo: check field validity
      // const postData = config as OpikConfig
    }

    if (type === TracingProvider.weave) {
      const postData = config as WeaveConfig
      if (!errorMessage && !postData.api_key)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'API Key' })
      if (!errorMessage && !postData.project)
        errorMessage = t('common.errorMsg.fieldRequired', { field: t(`${I18N_PREFIX}.project`) })
    }

    if (type === TracingProvider.aliyun) {
      const postData = config as AliyunConfig
      if (!errorMessage && !postData.app_name)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'App Name' })
      if (!errorMessage && !postData.license_key)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'License Key' })
      if (!errorMessage && !postData.endpoint)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'Endpoint' })
    }

    if (type === TracingProvider.tencent) {
      const postData = config as TencentConfig
      if (!errorMessage && !postData.token)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'Token' })
      if (!errorMessage && !postData.endpoint)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'Endpoint' })
      if (!errorMessage && !postData.service_name)
        errorMessage = t('common.errorMsg.fieldRequired', { field: 'Service Name' })
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
        message: t('common.api.success'),
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
            <PortalToFollowElemContent className='z-[60] h-full w-full'>
              <div className='fixed inset-0 flex items-center justify-center bg-background-overlay'>
                <div className='mx-2 max-h-[calc(100vh-120px)] w-[640px] overflow-y-auto rounded-2xl bg-components-panel-bg shadow-xl'>
                  <div className='px-8 pt-8'>
                    <div className='mb-4 flex items-center justify-between'>
                      <div className='title-2xl-semi-bold text-text-primary'>{t(`${I18N_PREFIX}.title`)}{t(`app.tracing.${type}.title`)}</div>
                    </div>

                    <div className='space-y-4'>
                      {type === TracingProvider.arize && (
                        <>
                          <Field
                            label='API Key'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as ArizeConfig).api_key}
                            onChange={handleConfigChange('api_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'API Key' })!}
                          />
                          <Field
                            label='Space ID'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as ArizeConfig).space_id}
                            onChange={handleConfigChange('space_id')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'Space ID' })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.project`)!}
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as ArizeConfig).project}
                            onChange={handleConfigChange('project')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.project`) })!}
                          />
                          <Field
                            label='Endpoint'
                            labelClassName='!text-sm'
                            value={(config as ArizeConfig).endpoint}
                            onChange={handleConfigChange('endpoint')}
                            placeholder={'https://otlp.arize.com'}
                          />
                        </>
                      )}
                      {type === TracingProvider.phoenix && (
                        <>
                          <Field
                            label='API Key'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as PhoenixConfig).api_key}
                            onChange={handleConfigChange('api_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'API Key' })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.project`)!}
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as PhoenixConfig).project}
                            onChange={handleConfigChange('project')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.project`) })!}
                          />
                          <Field
                            label='Endpoint'
                            labelClassName='!text-sm'
                            value={(config as PhoenixConfig).endpoint}
                            onChange={handleConfigChange('endpoint')}
                            placeholder={'https://app.phoenix.arize.com'}
                          />
                        </>
                      )}
                      {type === TracingProvider.aliyun && (
                        <>
                          <Field
                            label='License Key'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as AliyunConfig).license_key}
                            onChange={handleConfigChange('license_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'License Key' })!}
                          />
                          <Field
                            label='Endpoint'
                            labelClassName='!text-sm'
                            value={(config as AliyunConfig).endpoint}
                            onChange={handleConfigChange('endpoint')}
                            placeholder={'https://tracing.arms.aliyuncs.com'}
                          />
                          <Field
                            label='App Name'
                            labelClassName='!text-sm'
                            value={(config as AliyunConfig).app_name}
                            onChange={handleConfigChange('app_name')}
                          />
                        </>
                      )}
                      {type === TracingProvider.tencent && (
                        <>
                          <Field
                            label='Token'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as TencentConfig).token}
                            onChange={handleConfigChange('token')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'Token' })!}
                          />
                          <Field
                            label='Endpoint'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as TencentConfig).endpoint}
                            onChange={handleConfigChange('endpoint')}
                            placeholder='https://your-region.cls.tencentcs.com'
                          />
                          <Field
                            label='Service Name'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as TencentConfig).service_name}
                            onChange={handleConfigChange('service_name')}
                            placeholder='dify_app'
                          />
                        </>
                      )}
                      {type === TracingProvider.weave && (
                        <>
                          <Field
                            label='API Key'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as WeaveConfig).api_key}
                            onChange={handleConfigChange('api_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'API Key' })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.project`)!}
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as WeaveConfig).project}
                            onChange={handleConfigChange('project')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.project`) })!}
                          />
                          <Field
                            label='Entity'
                            labelClassName='!text-sm'
                            value={(config as WeaveConfig).entity}
                            onChange={handleConfigChange('entity')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'Entity' })!}
                          />
                          <Field
                            label='Endpoint'
                            labelClassName='!text-sm'
                            value={(config as WeaveConfig).endpoint}
                            onChange={handleConfigChange('endpoint')}
                            placeholder={'https://trace.wandb.ai/'}
                          />
                          <Field
                            label='Host'
                            labelClassName='!text-sm'
                            value={(config as WeaveConfig).host}
                            onChange={handleConfigChange('host')}
                            placeholder={'https://api.wandb.ai'}
                          />
                        </>
                      )}
                      {type === TracingProvider.langSmith && (
                        <>
                          <Field
                            label='API Key'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as LangSmithConfig).api_key}
                            onChange={handleConfigChange('api_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'API Key' })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.project`)!}
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as LangSmithConfig).project}
                            onChange={handleConfigChange('project')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.project`) })!}
                          />
                          <Field
                            label='Endpoint'
                            labelClassName='!text-sm'
                            value={(config as LangSmithConfig).endpoint}
                            onChange={handleConfigChange('endpoint')}
                            placeholder={'https://api.smith.langchain.com'}
                          />
                        </>
                      )}
                      {type === TracingProvider.langfuse && (
                        <>
                          <Field
                            label={t(`${I18N_PREFIX}.secretKey`)!}
                            labelClassName='!text-sm'
                            value={(config as LangFuseConfig).secret_key}
                            isRequired
                            onChange={handleConfigChange('secret_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.secretKey`) })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.publicKey`)!}
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as LangFuseConfig).public_key}
                            onChange={handleConfigChange('public_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.publicKey`) })!}
                          />
                          <Field
                            label='Host'
                            labelClassName='!text-sm'
                            isRequired
                            value={(config as LangFuseConfig).host}
                            onChange={handleConfigChange('host')}
                            placeholder='https://cloud.langfuse.com'
                          />
                        </>
                      )}
                      {type === TracingProvider.opik && (
                        <>
                          <Field
                            label='API Key'
                            labelClassName='!text-sm'
                            value={(config as OpikConfig).api_key}
                            onChange={handleConfigChange('api_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'API Key' })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.project`)!}
                            labelClassName='!text-sm'
                            value={(config as OpikConfig).project}
                            onChange={handleConfigChange('project')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.project`) })!}
                          />
                          <Field
                            label='Workspace'
                            labelClassName='!text-sm'
                            value={(config as OpikConfig).workspace}
                            onChange={handleConfigChange('workspace')}
                            placeholder={'default'}
                          />
                          <Field
                            label='Url'
                            labelClassName='!text-sm'
                            value={(config as OpikConfig).url}
                            onChange={handleConfigChange('url')}
                            placeholder={'https://www.comet.com/opik/api/'}
                          />
                        </>
                      )}
                    </div>
                    <div className='my-8 flex h-8 items-center justify-between'>
                      <a
                        className='flex items-center space-x-1 text-xs font-normal leading-[18px] text-[#155EEF]'
                        target='_blank'
                        href={docURL[type]}
                      >
                        <span>{t(`${I18N_PREFIX}.viewDocsLink`, { key: t(`app.tracing.${type}.title`) })}</span>
                        <LinkExternal02 className='h-3 w-3' />
                      </a>
                      <div className='flex items-center'>
                        {isEdit && (
                          <>
                            <Button
                              className='h-9 text-sm font-medium text-text-secondary'
                              onClick={showRemoveConfirm}
                            >
                              <span className='text-[#D92D20]'>{t('common.operation.remove')}</span>
                            </Button>
                            <Divider className='mx-3 h-[18px]' />
                          </>
                        )}
                        <Button
                          className='mr-2 h-9 text-sm font-medium text-text-secondary'
                          onClick={onCancel}
                        >
                          {t('common.operation.cancel')}
                        </Button>
                        <Button
                          className='h-9 text-sm font-medium'
                          variant='primary'
                          onClick={handleSave}
                          loading={isSaving}
                        >
                          {t(`common.operation.${isAdd ? 'saveAndEnable' : 'save'}`)}
                        </Button>
                      </div>

                    </div>
                  </div>
                  <div className='border-t-[0.5px] border-divider-regular'>
                    <div className='flex items-center justify-center bg-background-section-burn py-3 text-xs text-text-tertiary'>
                      <Lock01 className='mr-1 h-3 w-3 text-text-tertiary' />
                      {t('common.modelProvider.encrypted.front')}
                      <a
                        className='mx-1 text-primary-600'
                        target='_blank' rel='noopener noreferrer'
                        href='https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html'
                      >
                        PKCS1_OAEP
                      </a>
                      {t('common.modelProvider.encrypted.back')}
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
            type='warning'
            title={t(`${I18N_PREFIX}.removeConfirmTitle`, { key: t(`app.tracing.${type}.title`) })!}
            content={t(`${I18N_PREFIX}.removeConfirmContent`)}
            onConfirm={handleRemove}
            onCancel={hideRemoveConfirm}
          />
        )}
    </>
  )
}
export default React.memo(ProviderConfigModal)
