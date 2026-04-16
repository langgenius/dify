import type { UsagePriority } from '../use-credential-panel-state'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { PreferredProviderTypeEnum } from '../../declarations'

type UsagePrioritySectionProps = {
  value: UsagePriority
  disabled?: boolean
  onSelect: (key: PreferredProviderTypeEnum) => void
}

const options = [
  { key: PreferredProviderTypeEnum.system, labelKey: 'modelProvider.card.aiCreditsOption' },
  { key: PreferredProviderTypeEnum.custom, labelKey: 'modelProvider.card.apiKeyOption' },
] as const

export default function UsagePrioritySection({ value, disabled, onSelect }: UsagePrioritySectionProps) {
  const { t } = useTranslation()
  const selectedKey = value === 'credits'
    ? PreferredProviderTypeEnum.system
    : PreferredProviderTypeEnum.custom

  return (
    <div className="p-1">
      <div className="flex items-center gap-1 rounded-lg p-1">
        <div className="shrink-0 px-0.5 py-1">
          <span className="i-ri-arrow-up-double-line block h-4 w-4 text-text-tertiary" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 py-0.5">
          <span className="truncate system-sm-medium text-text-secondary">
            {t('modelProvider.card.usagePriority', { ns: 'common' })}
          </span>
          <Tooltip>
            <TooltipTrigger
              aria-label={t('modelProvider.card.usagePriorityTip', { ns: 'common' })}
              delay={0}
              render={(
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
                </span>
              )}
            />
            <TooltipContent>
              {t('modelProvider.card.usagePriorityTip', { ns: 'common' })}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {options.map(option => (
            <button
              key={option.key}
              type="button"
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-center whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-components-button-primary-border focus-visible:outline-hidden disabled:opacity-50',
                selectedKey === option.key
                  ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-panel-bg system-xs-medium text-text-primary shadow-xs'
                  : 'border border-components-option-card-option-border bg-components-option-card-option-bg system-xs-regular text-text-secondary hover:bg-components-option-card-option-bg-hover',
              )}
              disabled={disabled}
              onClick={() => onSelect(option.key)}
            >
              {t(option.labelKey, { ns: 'common' })}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
