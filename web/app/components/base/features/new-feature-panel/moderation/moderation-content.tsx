import type { FC } from 'react'
import type { ModerationContentConfig } from '@/models/debug'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const [presetResponse, setPresetResponse] = useState(config.preset_response || '')

  const handleConfigChange = (field: string, value: boolean | string) => {
    if (field === 'preset_response' && typeof value === 'string') value = value.slice(0, 100)

    onConfigChange({
      ...config,
      preset_response: field === 'preset_response' ? (value as string) : presetResponse,
      [field]: value,
    })
  }

  const handlePresetResponseChange = (value: string) => {
    const nextValue = value.slice(0, 100)
    setPresetResponse(nextValue)
    handleConfigChange('preset_response', nextValue)
  }

  return (
    <section
      aria-label={title}
      className="rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-xs"
    >
      <div className="flex min-h-10 items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1 system-sm-medium text-text-secondary">{title}</div>
        <div className="flex min-w-0 shrink-0 items-center justify-end">
          {info && (
            <div className="mr-2 truncate system-xs-regular text-text-tertiary" title={info}>
              {info}
            </div>
          )}
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => handleConfigChange('enabled', v)}
            aria-label={title}
          />
        </div>
      </div>
      {config.enabled && showPreset && (
        <div className="px-3 pt-0.5 pb-3">
          <div className="flex h-8 items-center justify-between gap-2">
            <span className="system-2xs-medium-uppercase text-text-secondary">
              {t(($) => $['feature.moderation.modal.content.preset'], { ns: 'appDebug' })}
            </span>
            <span className="flex shrink-0 items-center gap-0.5 rounded bg-background-section px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              <span className="i-ri-markdown-line size-3" aria-hidden />
              {t(($) => $['feature.moderation.modal.content.supportMarkdown'], { ns: 'appDebug' })}
            </span>
          </div>
          {/* Keep this counter composed locally; extract only if more textarea counter cases repeat. */}
          <div className="relative h-20">
            <Textarea
              aria-label={
                t(($) => $['feature.moderation.modal.content.preset'], { ns: 'appDebug' }) as string
              }
              value={presetResponse}
              className="size-full resize-none pb-8"
              placeholder={
                t(($) => $['feature.moderation.modal.content.placeholder'], { ns: 'appDebug' }) ||
                ''
              }
              onValueChange={handlePresetResponseChange}
            />
            <div className="absolute right-2 bottom-2 flex h-5 items-center rounded-md bg-background-section px-1 system-2xs-medium-uppercase text-text-quaternary">
              <span>{presetResponse.length}</span>/<span className="text-text-tertiary">100</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ModerationContent
