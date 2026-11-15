import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
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

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <span id={labelId} className="system-sm-semibold text-text-secondary">
          {t(($) => $['generativeUI.title'])}
        </span>
        <Infotip>
          <InfotipTrigger aria-labelledby={labelId} />
          <InfotipContent aria-labelledby={labelId}>
            {structuredOutputEnabled
              ? t(($) => $['generativeUI.structuredOutputConflict'])
              : t(($) => $['generativeUI.description'])}
          </InfotipContent>
        </Infotip>
      </div>
      <Switch
        aria-labelledby={labelId}
        checked={enabled}
        disabled={readOnly || (structuredOutputEnabled && !enabled)}
        onCheckedChange={onChange}
        size="md"
      />
    </div>
  )
}
