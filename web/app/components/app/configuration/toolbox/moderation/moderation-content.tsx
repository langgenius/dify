import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import type { ModerationContentConfig } from '@/models/debug'

type ModerationContentProps = {
  title: string
  info?: string
  showPreset?: boolean
  config: ModerationContentConfig
  onConfigChange: (config: ModerationContentConfig) => void
}
const ModerationContent: FC<ModerationContentProps> = ({
  title,
  info,
  showPreset = true,
  config,
  onConfigChange,
}) => {
  const { t } = useTranslation()

  const handleConfigChange = (field: string, value: boolean | string) => {
    if (field === 'preset_response' && typeof value === 'string')
      value = value.slice(0, 100)
    onConfigChange({ ...config, [field]: value })
  }

  return (
    <div className='py-2'>
      <div className='rounded-lg bg-gray-50 border border-gray-200'>
        <div className='flex items-center justify-between px-3 h-10 rounded-lg'>
          <div className='shrink-0 text-sm font-medium text-gray-900'>{title}</div>
          <div className='grow flex items-center justify-end'>
            {
              info && (
                <div className='mr-2 text-xs text-gray-500 truncate' title={info}>{info}</div>
              )
            }
            <Switch
              size='l'
              defaultValue={config.enabled}
              onChange={v => handleConfigChange('enabled', v)}
            />
          </div>
        </div>
        {
          config.enabled && showPreset && (
            <div className='px-3 pt-1 pb-3 bg-white rounded-lg'>
              <div className='flex items-center justify-between h-8 text-[13px] font-medium text-gray-700'>
                {t('appDebug.feature.moderation.modal.content.preset')}
                <span className='text-xs font-normal text-gray-500'>{t('appDebug.feature.moderation.modal.content.supportMarkdown')}</span>
              </div>
              <div className='relative px-3 py-2 h-20 rounded-lg bg-gray-100'>
                <textarea
                  value={config.preset_response || ''}
                  className='block w-full h-full bg-transparent text-sm outline-none appearance-none resize-none'
                  placeholder={t('appDebug.feature.moderation.modal.content.placeholder') || ''}
                  onChange={e => handleConfigChange('preset_response', e.target.value)}
                />
                <div className='absolute bottom-2 right-2 flex items-center px-1 h-5 rounded-md bg-gray-50 text-xs font-medium text-gray-300'>
                  <span>{(config.preset_response || '').length}</span>/<span className='text-gray-500'>100</span>
                </div>
              </div>
            </div>
          )
        }
      </div>
    </div>
  )
}

export default ModerationContent
