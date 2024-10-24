'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FeishuProvider } from './constants'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import type { FeishuConfig } from '@/models/common'
import Field from '@/app/components/datasets/create/website/base/field'
import Toast from '@/app/components/base/toast'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { updateDataSourceFeishuConfig } from '@/service/common'
type Props = {
  onCancel: () => void
  onSaved: () => void
}

const I18N_PREFIX = 'datasetCreation.feishu'

const FeishuConfigModal: FC<Props> = ({
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation()
  const [isSaving, setIsSaving] = useState(false)
  const [config, setConfig] = useState<FeishuConfig>({
    app_id: '',
    app_secret: '',
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

    if (!errorMsg) {
      if (!config.app_id) {
        errorMsg = t('common.errorMsg.fieldRequired', {
          field: 'App Id',
        })
      }
      if (!config.app_secret) {
        errorMsg = t('common.errorMsg.fieldRequired', {
          field: 'App Secret',
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

    try {
      setIsSaving(true)
      await updateDataSourceFeishuConfig({
        url: `/oauth/data-source/${FeishuProvider}`,
        body: {
          app_id: config.app_id,
          app_secret: config.app_secret,
        },
      })

      Toast.notify({
        type: 'success',
        message: t('common.api.success'),
      })
    }
    finally {
      setIsSaving(false)
    }

    onSaved()
  }, [config.app_id, config.app_secret, onSaved, t, isSaving])

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className='w-full h-full z-[60]'>
        <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
          <div className='mx-2 w-[640px] max-h-[calc(100vh-120px)] bg-white shadow-xl rounded-2xl overflow-y-auto'>
            <div className='px-8 pt-8'>
              <div className='flex justify-between items-center mb-4'>
                <div className='text-xl font-semibold text-gray-900'>{t(`${I18N_PREFIX}.configFeishu`)}</div>
              </div>
              <div className='space-y-4'>
                <Field
                  label='App Id'
                  labelClassName='!text-sm'
                  isRequired
                  value={config.app_id}
                  onChange={handleConfigChange('app_id')}
                  placeholder={t(`${I18N_PREFIX}.appIdPlaceholder`)!}
                />
                <Field
                  label='App Secret'
                  labelClassName='!text-sm'
                  isRequired
                  type="password"
                  value={config.app_secret}
                  onChange={handleConfigChange('app_secret')}
                  placeholder={t(`${I18N_PREFIX}.appSecretPlaceholder`)!}
                />
              </div>
              <div className='my-8 flex justify-between items-center h-8'>
                <a className='flex items-center space-x-1 leading-[18px] text-xs font-normal text-[#155EEF]' target='_blank' href='https://open.larkoffice.com/app'>
                  <span>{t(`${I18N_PREFIX}.getApiKeyLinkText`)}</span>
                  <LinkExternal02 className='w-3 h-3' />
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
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(FeishuConfigModal)
