'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Button from '@/app/components/base/button'
import type { FirecrawlConfig } from '@/models/common'
import Field from '@/app/components/datasets/create/website/base/field'
import Toast from '@/app/components/base/toast'
import { createDataSourceApiKeyBinding } from '@/service/datasets'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
type Props = {
  onCancel: () => void
  onSaved: () => void
}

const I18N_PREFIX = 'datasetCreation.firecrawl'

const DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

const ConfigFirecrawlModal: FC<Props> = ({
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation()
  const [isSaving, setIsSaving] = useState(false)
  const [config, setConfig] = useState<FirecrawlConfig>({
    api_key: '',
    base_url: '',
  })

  const handleConfigChange = useCallback((key: string) => {
    return (value: string | number) => {
      setConfig(prev => ({ ...prev, [key]: value as string }))
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (isSaving)
      return
    let errorMsg = ''
    if (config.base_url && !((config.base_url.startsWith('http://') || config.base_url.startsWith('https://'))))
      errorMsg = t('common.errorMsg.urlError')
    if (!errorMsg) {
      if (!config.api_key) {
        errorMsg = t('common.errorMsg.fieldRequired', {
          field: 'API Key',
        })
      }
    }

    if (errorMsg) {
      Toast.notify({
        type: 'error',
        message: errorMsg,
      })
      return
    }
    const postData = {
      category: 'website',
      provider: 'firecrawl',
      credentials: {
        auth_type: 'bearer',
        config: {
          api_key: config.api_key,
          base_url: config.base_url || DEFAULT_BASE_URL,
        },
      },
    }
    try {
      setIsSaving(true)
      await createDataSourceApiKeyBinding(postData)
      Toast.notify({
        type: 'success',
        message: t('common.api.success'),
      })
    }
    finally {
      setIsSaving(false)
    }

    onSaved()
  }, [config.api_key, config.base_url, onSaved, t, isSaving])

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className='z-[60] h-full w-full'>
        <div className='fixed inset-0 flex items-center justify-center bg-background-overlay'>
          <div className='mx-2 max-h-[calc(100vh-120px)] w-[640px] overflow-y-auto rounded-2xl bg-components-panel-bg shadow-xl'>
            <div className='px-8 pt-8'>
              <div className='mb-4 flex items-center justify-between'>
                <div className='system-xl-semibold text-text-primary'>{t(`${I18N_PREFIX}.configFirecrawl`)}</div>
              </div>

              <div className='space-y-4'>
                <Field
                  label='API Key'
                  labelClassName='!text-sm'
                  isRequired
                  value={config.api_key}
                  onChange={handleConfigChange('api_key')}
                  placeholder={t(`${I18N_PREFIX}.apiKeyPlaceholder`)!}
                />
                <Field
                  label='Base URL'
                  labelClassName='!text-sm'
                  value={config.base_url}
                  onChange={handleConfigChange('base_url')}
                  placeholder={DEFAULT_BASE_URL}
                />
              </div>
              <div className='my-8 flex h-8 items-center justify-between'>
                <a className='flex items-center space-x-1 text-xs font-normal leading-[18px] text-text-accent' target='_blank' href='https://www.firecrawl.dev/account'>
                  <span>{t(`${I18N_PREFIX}.getApiKeyLinkText`)}</span>
                  <LinkExternal02 className='h-3 w-3' />
                </a>
                <div className='flex'>
                  <Button
                    size='large'
                    className='mr-2'
                    onClick={onCancel}
                  >
                    {t('common.operation.cancel')}
                  </Button>
                  <Button
                    variant='primary'
                    size='large'
                    onClick={handleSave}
                    loading={isSaving}
                  >
                    {t('common.operation.save')}
                  </Button>
                </div>

              </div>
            </div>
            <div className='border-t-[0.5px] border-t-divider-regular'>
              <div className='flex items-center justify-center bg-background-section-burn py-3 text-xs text-text-tertiary'>
                <Lock01 className='mr-1 h-3 w-3 text-text-tertiary' />
                {t('common.modelProvider.encrypted.front')}
                <a
                  className='mx-1 text-text-accent'
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
export default React.memo(ConfigFirecrawlModal)
