import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/app/components/base/ui/number-field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'

import { cn } from '@/utils/classnames'

type MaxIterationsProps = {
  value?: number
  onChange?: (value: number) => void
  className?: string
  disabled?: boolean
}
const MaxIterations = ({ value = 10, onChange, className, disabled }: MaxIterationsProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('mt-3 flex h-10 items-center justify-between', className)}>
      <div className="flex items-center">
        <div className="mr-0.5 truncate uppercase text-text-secondary system-sm-semibold">
          {t('nodes.agent.maxIterations', { ns: 'workflow' })}
        </div>
        <Tooltip>
          <TooltipTrigger
            delay={0}
            className="flex h-4 w-4 shrink-0 items-center justify-center"
          >
            <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
          </TooltipTrigger>
          <TooltipContent>{t('nodes.llm.tools.maxIterationsTooltip', { ns: 'workflow' })}</TooltipContent>
        </Tooltip>
      </div>
      <NumberField
        value={value}
        onValueChange={v => (onChange ?? (() => {}))(v ?? 1)}
        min={1}
        step={1}
        disabled={disabled}
      >
        <NumberFieldGroup className={cn('w-20 shrink-0', disabled && 'opacity-50')}>
          <NumberFieldInput />
          <NumberFieldControls>
            <NumberFieldIncrement />
            <NumberFieldDecrement />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    </div>
  )
}

export default memo(MaxIterations)
