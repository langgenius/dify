'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Field from './field'
import type { LangFuseConfig, LangSmithConfig } from './type'
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

type Props = {
  appId: string
  type: TracingProvider
  payload?: LangSmithConfig | LangFuseConfig | null
  onRemoved: () => void
  onCancel: () => void
  onSaved: (payload: LangSmithConfig | LangFuseConfig) => void
  onChosen: (provider: TracingProvider) => void
}

const I18N_PREFIX = 'app.tracing.configProvider'

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
  const [config, setConfig] = useState<LangSmithConfig | LangFuseConfig>((() => {
    if (isEdit)
      return payload

    if (type === TracingProvider.langSmith)
      return langSmithConfigTemplate

    return langFuseConfigTemplate
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
            <PortalToFollowElemContent className='w-full h-full z-[60]'>
              <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
                <div className='mx-2 w-[640px] max-h-[calc(100vh-120px)] bg-white shadow-xl rounded-2xl overflow-y-auto'>
                  <div className='px-8 pt-8'>
                    <div className='flex justify-between items-center mb-4'>
                      <div className='text-xl font-semibold text-gray-900'>{t(`${I18N_PREFIX}.title`)}{t(`app.tracing.${type}.title`)}</div>
                    </div>

                    <div className='space-y-4'>
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

                    </div>
                    <div className='my-8 flex justify-between items-center h-8'>
                      <a
                        className='flex items-center space-x-1 leading-[18px] text-xs font-normal text-[#155EEF]'
                        target='_blank'
                        href={docURL[type]}
                      >
                        <span>{t(`${I18N_PREFIX}.viewDocsLink`, { key: t(`app.tracing.${type}.title`) })}</span>
                        <LinkExternal02 className='w-3 h-3' />
                      </a>
                      <div className='flex items-center'>
                        {isEdit && (
                          <>
                            <Button
                              className='h-9 text-sm font-medium text-gray-700'
                              onClick={showRemoveConfirm}
                            >
                              <span className='text-[#D92D20]'>{t('common.operation.remove')}</span>
                            </Button>
                            <div className='mx-3 w-px h-[18px] bg-gray-200'></div>
                          </>
                        )}
                        <Button
                          className='mr-2 h-9 text-sm font-medium text-gray-700'
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
                  <div className='border-t-[0.5px] border-t-black/5'>
                    <div className='flex justify-center items-center py-3 bg-gray-50 text-xs text-gray-500'>
                      <Lock01 className='mr-1 w-3 h-3 text-gray-500' />
                      {t('common.modelProvider.encrypted.front')}
                      <a
                        className='text-primary-600 mx-1'
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
