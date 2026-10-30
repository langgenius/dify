import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  enabled: boolean
  structuredOutputEnabled: boolean
  readOnly: boolean
  onChange: (enabled: boolean) => void
}

export default function GenerativeUIConfig({
  enabled,
  structuredOutputEnabled,
  readOnly,
  onChange,
}: Props) {
  const { t } = useTranslation(['appDebug'])
  const labelId = useId()
  const descriptionId = useId()

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="system-sm-semibold text-text-secondary">
          {t(($) => $['generativeUI.title'])}
        </span>
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={enabled}
          disabled={readOnly || (structuredOutputEnabled && !enabled)}
          onCheckedChange={onChange}
          size="md"
        />
      </div>
      <p id={descriptionId} className="system-xs-regular text-text-tertiary">
        {structuredOutputEnabled
          ? t(($) => $['generativeUI.structuredOutputConflict'])
          : t(($) => $['generativeUI.description'])}
      </p>
    </div>
  )
}
