import { Textarea } from '@langgenius/dify-ui/textarea'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'

type SummaryTextProps = {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
}
const SummaryText = ({ value, onChange, disabled }: SummaryTextProps) => {
  const { t } = useTranslation(['datasetDocuments'])
  const labelId = useId()

  return (
    <div className="space-y-1">
      <div id={labelId} className="system-xs-medium-uppercase text-text-tertiary">
        {t(($) => $['segment.summary'], { ns: 'datasetDocuments' })}
      </div>
      <Textarea
        aria-labelledby={labelId}
        className="field-sizing-content min-h-6 w-full resize-none rounded-none border-none bg-transparent p-0 body-sm-regular leading-6 text-text-secondary hover:border-none hover:bg-transparent focus:border-none focus:bg-transparent focus:shadow-none focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset disabled:bg-transparent disabled:text-text-secondary disabled:hover:bg-transparent"
        placeholder={t(($) => $['segment.summaryPlaceholder'], { ns: 'datasetDocuments' })}
        rows={1}
        value={value ?? ''}
        onValueChange={(value) => onChange?.(value)}
        disabled={disabled}
      />
    </div>
  )
}

export default memo(SummaryText)
