'use client'

import type { RadioGroupProps } from '@langgenius/dify-ui/radio-group'
import type { CommandOption, ScopeSelection } from '../command-options'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useTranslation } from 'react-i18next'

type ScopeBarProps = Pick<RadioGroupProps<ScopeSelection>, 'value' | 'onValueChange'> & {
  scopes: CommandOption[]
}

export function ScopeBar({ scopes, value, onValueChange }: ScopeBarProps) {
  const { t } = useTranslation(['app'])
  const items = [
    { value: 'all' as const, title: t(($) => $['types.all'], { ns: 'app' }) },
    ...scopes.flatMap((option) =>
      option.scope ? [{ value: option.scope, title: option.title }] : [],
    ),
  ]

  return (
    <div
      data-base-ui-swipe-ignore="x"
      className="shrink-0 scrollbar-none overflow-x-auto px-4 pb-3"
    >
      <RadioGroup<ScopeSelection>
        aria-label={t(($) => $['gotoAnything.selectSearchType'], { ns: 'app' })}
        value={value}
        onValueChange={onValueChange}
        className="gap-1"
      >
        {items.map((item) => (
          <RadioItem
            key={item.value}
            value={item.value}
            nativeButton
            render={<button type="button" />}
            className="flex h-7 shrink-0 touch-manipulation items-center rounded-lg border-[0.5px] border-transparent px-2.5 system-sm-medium whitespace-nowrap text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid data-checked:border-components-segmented-control-item-active-border data-checked:bg-components-segmented-control-item-active-bg data-checked:text-text-accent-light-mode-only data-checked:shadow-xs data-checked:shadow-shadow-shadow-3"
          >
            {item.title}
          </RadioItem>
        ))}
      </RadioGroup>
    </div>
  )
}
