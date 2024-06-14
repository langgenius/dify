'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Field from './field'
import { TracingProvider } from './type'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Button from '@/app/components/base/button'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
type Props = {
  type: TracingProvider
  payload?: any
  onCancel: () => void
  onSaved: () => void
}

const I18N_PREFIX = 'app.tracing.config'

const ProviderConfigModal: FC<Props> = ({
  type,
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation()
  const [isSaving, setIsSaving] = useState(false)
  const [config, setConfig] = useState<Record<string, string>>({})

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
    <PortalToFollowElem open>
      <PortalToFollowElemContent className='w-full h-full z-[60]'>
        <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
          <div className='mx-2 w-[640px] max-h-[calc(100vh-120px)] bg-white shadow-xl rounded-2xl overflow-y-auto'>
            <div className='px-8 pt-8'>
              <div className='flex justify-between items-center mb-4'>
                <div className='text-xl font-semibold text-gray-900'>{t(`${I18N_PREFIX}.configFirecrawl`)}</div>
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
                      placeholder={'Enter your API Key'}
                    />
                    <Field
                      label='Project'
                      labelClassName='!text-sm'
                      isRequired
                      value={config.base_url}
                      onChange={handleConfigChange('project')}
                      placeholder={'Enter your Project'}
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
                      label='Public Key'
                      labelClassName='!text-sm'
                      isRequired
                      value={config.api_key}
                      onChange={handleConfigChange('public_key')}
                      placeholder={'Enter your Public Key'}
                    />
                    <Field
                      label='Private Key'
                      labelClassName='!text-sm'
                      value={config.base_url}
                      isRequired
                      onChange={handleConfigChange('base_url')}
                      placeholder={'Enter your Private Key'}
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
                <a className='flex items-center space-x-1 leading-[18px] text-xs font-normal text-[#155EEF]' target='_blank' href='https://www.firecrawl.dev/account'>
                  <span>{t(`${I18N_PREFIX}.getApiKeyLinkText`)}</span>
                  <LinkExternal02 className='w-3 h-3' />
                </a>
                <div className='flex'>
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
}
export default React.memo(ProviderConfigModal)
