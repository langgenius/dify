import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from 'react-textarea-autosize'
import { cn } from '@/utils/classnames'

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
      <div className="text-text-tertiary system-xs-medium-uppercase">{t('segment.summary', { ns: 'datasetDocuments' })}</div>
      <Textarea
        className={cn(
          'w-full resize-none bg-transparent leading-6 text-text-secondary outline-none body-sm-regular',
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
