import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from 'react-textarea-autosize'
import { useTabFocusRing } from './use-tab-focus-ring'

type SummaryTextProps = {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
}
const SummaryText = ({ value, onChange, disabled }: SummaryTextProps) => {
  const { t } = useTranslation(['datasetDocuments'])
  const tabFocus = useTabFocusRing()

  return (
    <div className="space-y-1">
      <div className="system-xs-medium-uppercase text-text-tertiary">
        {t(($) => $['segment.summary'], { ns: 'datasetDocuments' })}
      </div>
      <Textarea
        className={cn(
          'w-full resize-none bg-transparent body-sm-regular leading-6 text-text-secondary outline-hidden data-[tab-focus=true]:ring-2 data-[tab-focus=true]:ring-state-accent-solid data-[tab-focus=true]:ring-inset',
        )}
        data-tab-focus={tabFocus.isTabFocused}
        placeholder={t(($) => $['segment.summaryPlaceholder'], { ns: 'datasetDocuments' })}
        minRows={1}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        onFocus={tabFocus.onFocus}
        onBlur={tabFocus.onBlur}
      />
    </div>
  )
}

export default memo(SummaryText)
