'use client'

import type { RadioGroupProps } from '@langgenius/dify-ui/radio-group'
import type { ScopeOption, ScopeSelection } from '../command-options'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { ScrollArea, ScrollAreaContent, ScrollAreaViewport } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'

type ScopeBarProps = Pick<RadioGroupProps<ScopeSelection>, 'value' | 'onValueChange'> & {
  scopes: ScopeOption[]
}

export function ScopeBar({ scopes, value, onValueChange }: ScopeBarProps) {
  const { t } = useTranslation(['app'])
  const items = [
    { value: 'all' as const, title: t(($) => $['types.all'], { ns: 'app' }) },
    ...scopes.map((option) => ({ value: option.scope, title: option.title })),
  ]

  return (
    <ScrollArea className="shrink-0 pb-2">
      <ScrollAreaViewport
        tabIndex={-1}
        style={{ overflowY: 'hidden' }}
        className="mask-[linear-gradient(to_right,transparent,#000_min(1.5rem,var(--scroll-area-overflow-x-start,0px)),#000_calc(100%-min(1.5rem,var(--scroll-area-overflow-x-end,0px))),transparent)] has-focus-visible:mask-none data-has-overflow-x:overscroll-x-contain"
      >
        <ScrollAreaContent className="px-4 py-1">
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
        </ScrollAreaContent>
      </ScrollAreaViewport>
    </ScrollArea>
  )
}
