import type { UsagePriority } from '../use-credential-panel-state'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { PreferredProviderTypeEnum } from '../../declarations'

type UsagePrioritySectionProps = {
  value: UsagePriority
  onSelect: (key: PreferredProviderTypeEnum) => void
}

const options = [
  { key: PreferredProviderTypeEnum.system, labelKey: 'modelProvider.card.aiCreditsOption' },
  { key: PreferredProviderTypeEnum.custom, labelKey: 'modelProvider.card.apiKeyOption' },
] as const

export default function UsagePrioritySection({ value, onSelect }: UsagePrioritySectionProps) {
  const { t } = useTranslation()
  const selectedKey = value === 'credits'
    ? PreferredProviderTypeEnum.system
    : PreferredProviderTypeEnum.custom

  return (
    <div className="border-b border-b-divider-subtle px-3 pb-2 pt-2.5">
      <div className="mb-1.5 flex items-center gap-1 text-text-tertiary system-xs-medium">
        <span className="i-ri-arrow-up-down-line h-4 w-4 shrink-0" />
        <span>{t('modelProvider.card.usagePriority', { ns: 'common' })}</span>
        <span className="i-ri-question-line h-3.5 w-3.5 shrink-0 text-text-quaternary" />
      </div>
      <div className="flex gap-1.5">
        {options.map(option => (
          <button
            key={option.key}
            type="button"
            className={cn(
              'flex-1 rounded-lg px-2 py-1 text-center transition-colors system-xs-medium',
              selectedKey === option.key
                ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-panel-bg text-text-primary shadow-xs'
                : 'border border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary hover:bg-components-option-card-option-bg-hover',
            )}
            onClick={() => onSelect(option.key)}
          >
            {t(option.labelKey, { ns: 'common' })}
          </button>
        ))}
      </div>
    </div>
  )
}
