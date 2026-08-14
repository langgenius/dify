'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'

const retrievalModes = ['fast', 'deep', 'research'] as const

export type RetrievalMode = (typeof retrievalModes)[number]

export function RetrievalModeSegmentedControl({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  appearance = 'default',
  disabled = false,
  value,
  onChange,
}: {
  'aria-label'?: string
  'aria-labelledby'?: string
  appearance?: 'composer' | 'default'
  disabled?: boolean
  value: RetrievalMode
  onChange: (value: RetrievalMode) => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <SegmentedControl<RetrievalMode>
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(
        appearance === 'composer' && 'flex min-w-46.5 gap-0.5 bg-background-section-burn',
      )}
      value={value}
      onValueChange={onChange}
    >
      {retrievalModes.map((mode) => (
        <SegmentedControlItem<RetrievalMode>
          key={mode}
          value={mode}
          disabled={disabled}
          className={cn(
            appearance === 'composer' &&
              'grow border-0 px-2.5 py-1.25 system-sm-regular text-text-tertiary capitalize data-checked:bg-components-panel-bg data-checked:font-medium data-checked:text-text-primary',
          )}
        >
          {t(($) => $[`newKnowledge.settings.retrievalMode.${mode}`])}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}
