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
      <div className='bg-components-panel-bg border-components-panel-border rounded-lg border'>
        <div className='flex h-10 items-center justify-between rounded-lg px-3'>
          <div className='text-text-primary shrink-0 text-sm font-medium'>{title}</div>
          <div className='flex grow items-center justify-end'>
            {
              info && (
                <div className='text-text-tertiary mr-2 truncate text-xs' title={info}>{info}</div>
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
            <div className='bg-components-panel-bg rounded-lg px-3 pb-3 pt-1'>
              <div className='text-text-secondary flex h-8 items-center justify-between text-[13px] font-medium'>
                {t('appDebug.feature.moderation.modal.content.preset')}
                <span className='text-text-tertiary text-xs font-normal'>{t('appDebug.feature.moderation.modal.content.supportMarkdown')}</span>
              </div>
              <div className='bg-components-input-bg-normal relative h-20 rounded-lg px-3 py-2'>
                <textarea
                  value={config.preset_response || ''}
                  className='text-text-secondary block h-full w-full resize-none appearance-none bg-transparent text-sm outline-none'
                  placeholder={t('appDebug.feature.moderation.modal.content.placeholder') || ''}
                  onChange={e => handleConfigChange('preset_response', e.target.value)}
                />
                <div className='bg-background-section text-text-quaternary absolute bottom-2 right-2 flex h-5 items-center rounded-md px-1 text-xs font-medium'>
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
