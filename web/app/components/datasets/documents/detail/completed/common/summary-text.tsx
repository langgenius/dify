import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from 'react-textarea-autosize'

type SummaryTextProps = {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
}
const SummaryText = ({
  value,
  onChange,
  disabled,
}: SummaryTextProps) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-1">
      <div className="system-xs-medium-uppercase text-text-tertiary">{t('segment.summary', { ns: 'datasetDocuments' })}</div>
      <Textarea
        className={cn(
          'w-full resize-none bg-transparent body-sm-regular leading-6 text-text-secondary outline-hidden',
        )}
        placeholder={t('segment.summaryPlaceholder', { ns: 'datasetDocuments' })}
        minRows={1}
        value={value ?? ''}
        onChange={e => onChange?.(e.target.value)}
        disabled={disabled}
      />
    </div>
  )
}

export default memo(SummaryText)
