import type { ChangeEvent, FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModerationContent from './moderation-content'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import type { ModerationConfig, ModerationContentConfig } from '@/models/debug'
import { useToastContext } from '@/app/components/base/toast'

type ModerationSettingModalProps = {
  data: ModerationConfig
  onCancel: () => void
  onSave: (moderationConfig: ModerationConfig) => void
}

const ModerationSettingModal: FC<ModerationSettingModalProps> = ({
  data,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [localeData, setLocaleData] = useState<ModerationConfig>(data)
  const providers = [
    {
      key: 'openai',
      name: t('appDebug.feature.moderation.modal.provider.openai'),
    },
    {
      key: 'keywords',
      name: t('appDebug.feature.moderation.modal.provider.keywords'),
    },
    {
      key: 'api_based',
      name: t('common.apiBasedExtension.selector.title'),
    },
  ]

  const handleDataTypeChange = (type: string) => {
    setLocaleData({ ...localeData, type })
  }

  const handleDataKeywordsChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value

    const arr = value.split('\n').reduce((prev: string[], next: string) => {
      if (next !== '')
        prev.push(next.slice(0, 100))
      if (next === '' && prev[prev.length - 1] !== '')
        prev.push(next)

      return prev
    }, [])

    setLocaleData({
      ...localeData,
      configs: {
        ...localeData.configs,
        keywords: arr.slice(0, 100).join('\n'),
      },
    })
  }

  const handleDataContentChange = (contentType: string, contentConfig: ModerationContentConfig) => {
    setLocaleData({
      ...localeData,
      configs: {
        ...localeData.configs,
        [contentType]: contentConfig,
      },
    })
  }

  const handleSave = () => {
    if (!localeData.configs?.inputs_configs?.enabled && !localeData.configs?.outputs_configs?.enabled) {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.content.condition') })
      return
    }

    if (localeData.type === 'keywords' && !localeData.configs.keywords) {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.keywords.errorMessage') })
      return
    }

    if (localeData.type === 'api_based' && !localeData.configs.api_based_extension_id) {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.apiBased.errorMessage') })
      return
    }

    if (localeData.configs.inputs_configs?.enabled && !localeData.configs.inputs_configs.preset_response && localeData.type !== 'api_based') {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.content.errorMessage') })
      return
    }

    if (localeData.configs.outputs_configs?.enabled && !localeData.configs.outputs_configs.preset_response && localeData.type !== 'api_based') {
      notify({ type: 'error', message: t('appDebug.feature.moderation.modal.content.errorMessage') })
      return
    }

    onSave(localeData)
  }

  return (
    <Modal
      isShow
      onClose={() => {}}
      className='!p-8 !pb-6 !max-w-none !w-[640px]'
    >
      <div className='mb-2 text-xl font-semibold text-[#1D2939]'>
        {t('appDebug.feature.moderation.modal.title')}
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('appDebug.feature.moderation.modal.provider.title')}
        </div>
        <div className='grid gap-2.5 grid-cols-3'>
          {
            providers.map(provider => (
              <div
                key={provider.key}
                className={`
                  flex items-center px-3 py-2 rounded-lg text-sm text-gray-900 cursor-pointer
                  ${localeData.type === provider.key ? 'bg-white border-[1.5px] border-primary-400 shadow-sm' : 'border border-gray-100 bg-gray-25'}
                `}
                onClick={() => handleDataTypeChange(provider.key)}
              >
                <div className={`
                  mr-2 w-4 h-4 rounded-full border 
                  ${localeData.type === provider.key ? 'border-[5px] border-primary-600' : 'border border-gray-300'}`} />
                {provider.name}
              </div>
            ))
          }
        </div>
      </div>
      {
        localeData.type === 'keywords' && (
          <div className='py-2'>
            <div className='mb-1 text-sm font-medium text-gray-900'>{t('appDebug.feature.moderation.modal.provider.keywords')}</div>
            <div className='mb-2 text-xs text-gray-500'>{t('appDebug.feature.moderation.modal.keywords.tip')}</div>
            <div className='relative px-3 py-2 h-[88px] bg-gray-100 rounded-lg'>
              <textarea
                value={localeData.configs?.keywords || ''}
                onChange={handleDataKeywordsChange}
                className='block w-full h-full bg-transparent text-sm outline-none appearance-none resize-none'
                placeholder={t('appDebug.feature.moderation.modal.keywords.placeholder') || ''}
              />
              <div className='absolute bottom-2 right-2 flex items-center px-1 h-5 rounded-md bg-gray-50 text-xs font-medium text-gray-300'>
                <span>{(localeData.configs?.keywords || '').split('\n').filter(Boolean).length}</span>/<span className='text-gray-500'>100 {t('appDebug.feature.moderation.modal.keywords.line')}</span>
              </div>
            </div>
          </div>
        )
      }
      {
        localeData.type === 'api_based' && (
          <div className='py-2'>
            <div className='flex items-center justify-between h-9'>
              <div className='text-sm font-medium text-gray-900'>{t('common.apiBasedExtension.selector.title')}</div>
              <a
                href={'/'}
                className='flex items-center text-xs text-gray-500'
              >
                <BookOpen01 className='mr-1 w-3 h-3 text-gray-500' />
                {t('common.apiBasedExtension.link')}
              </a>
            </div>
            <ApiBasedExtensionSelector />
          </div>
        )
      }
      <div className='my-3 h-[1px] bg-gradient-to-r from-[#F3F4F6]'></div>
      <ModerationContent
        title={t('appDebug.feature.moderation.modal.content.input') || ''}
        config={localeData.configs?.inputs_configs || { enabled: false, preset_response: '' }}
        onConfigChange={config => handleDataContentChange('inputs_configs', config)}
        info={(localeData.type === 'api_based' && t('appDebug.feature.moderation.modal.content.fromApi')) || ''}
        showPreset={!(localeData.type === 'api_based')}
      />
      <ModerationContent
        title={t('appDebug.feature.moderation.modal.content.output') || ''}
        config={localeData.configs?.outputs_configs || { enabled: false, preset_response: '' }}
        onConfigChange={config => handleDataContentChange('outputs_configs', config)}
        info={(localeData.type === 'api_based' && t('appDebug.feature.moderation.modal.content.fromApi')) || ''}
        showPreset={!(localeData.type === 'api_based')}
      />
      <div className='mt-1 mb-8 text-xs font-medium text-gray-500'>{t('appDebug.feature.moderation.modal.content.condition')}</div>
      <div className='flex items-center justify-end'>
        <Button
          onClick={onCancel}
          className='mr-2 text-sm font-medium'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          type='primary'
          className='text-sm font-medium'
          onClick={handleSave}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </Modal>
  )
}

export default ModerationSettingModal
