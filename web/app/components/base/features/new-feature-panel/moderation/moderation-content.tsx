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
      <div className='rounded-lg bg-components-panel-bg border border-components-panel-border'>
        <div className='flex items-center justify-between px-3 h-10 rounded-lg'>
          <div className='shrink-0 text-sm font-medium text-text-primary'>{title}</div>
          <div className='grow flex items-center justify-end'>
            {
              info && (
                <div className='mr-2 text-xs text-text-tertiary truncate' title={info}>{info}</div>
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
            <div className='px-3 pt-1 pb-3 bg-components-panel-bg rounded-lg'>
              <div className='flex items-center justify-between h-8 text-[13px] font-medium text-text-secondary'>
                {t('appDebug.feature.moderation.modal.content.preset')}
                <span className='text-xs font-normal text-text-tertiary'>{t('appDebug.feature.moderation.modal.content.supportMarkdown')}</span>
              </div>
              <div className='relative px-3 py-2 h-20 rounded-lg bg-components-input-bg-normal'>
                <textarea
                  value={config.preset_response || ''}
                  className='block w-full h-full bg-transparent text-sm text-text-secondary outline-none appearance-none resize-none'
                  placeholder={t('appDebug.feature.moderation.modal.content.placeholder') || ''}
                  onChange={e => handleConfigChange('preset_response', e.target.value)}
                />
                <div className='absolute bottom-2 right-2 flex items-center px-1 h-5 rounded-md bg-background-section text-xs font-medium text-text-quaternary'>
                  <span>{(config.preset_response || '').length}</span>/<span className='text-text-tertiary'>100</span>
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
