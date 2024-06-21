'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Field from './field'
import { TracingProvider } from './type'
import { docURL } from './config'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Button from '@/app/components/base/button'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import ConfirmUi from '@/app/components/base/confirm'
type Props = {
  type: TracingProvider
  payload?: any
  onRemove?: () => void
  onCancel: () => void
  onSaved: () => void
}

const I18N_PREFIX = 'app.tracing.configProvider'

const ProviderConfigModal: FC<Props> = ({
  type,
  payload,
  onRemove,
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation()
  const isEdit = !!payload
  const [isSaving, setIsSaving] = useState(false)
  const [config, setConfig] = useState<Record<string, string>>({})
  const [isShowRemoveConfirm, {
    setTrue: showRemoveConfirm,
    setFalse: hideRemoveConfirm,
  }] = useBoolean(false)

  const handleRemove = useCallback(async () => {
    hideRemoveConfirm()
    onRemove?.()
  }, [onRemove, hideRemoveConfirm])

  const handleConfigChange = useCallback((key: string) => {
    return () => {

    }
  }, [])

  const handleSave = useCallback(async () => {
    if (isSaving)
      return

    onSaved()
  }, [isSaving, onSaved])

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
                            value={config.api_key}
                            onChange={handleConfigChange('api_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: 'API Key' })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.project`)!}
                            labelClassName='!text-sm'
                            isRequired
                            value={config.base_url}
                            onChange={handleConfigChange('project')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.project`) })!}
                          />
                          <Field
                            label='Endpoint'
                            labelClassName='!text-sm'
                            value={config.base_url}
                            onChange={handleConfigChange('endpoint')}
                            placeholder={'https://api.smith.langchain.com'}
                          />
                        </>
                      )}
                      {type === TracingProvider.langfuse && (
                        <>
                          <Field
                            label={t(`${I18N_PREFIX}.publicKey`)!}
                            labelClassName='!text-sm'
                            isRequired
                            value={config.api_key}
                            onChange={handleConfigChange('public_key')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.publicKey`) })!}
                          />
                          <Field
                            label={t(`${I18N_PREFIX}.secretKey`)!}
                            labelClassName='!text-sm'
                            value={config.base_url}
                            isRequired
                            onChange={handleConfigChange('base_url')}
                            placeholder={t(`${I18N_PREFIX}.placeholder`, { key: t(`${I18N_PREFIX}.secretKey`) })!}
                          />
                          <Field
                            label='Host'
                            labelClassName='!text-sm'
                            value={config.base_url}
                            onChange={handleConfigChange('base_url')}
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
                        {!isEdit && (
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
                          type='primary'
                          onClick={handleSave}
                          loading={isSaving}
                        >
                          {t('common.operation.save')}
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
          <ConfirmUi
            isShow
            onClose={hideRemoveConfirm}
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
