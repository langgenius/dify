import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { ComboboxIcon, ComboboxTrigger } from '@langgenius/dify-ui/combobox'

export function PreferenceComboboxTrigger({ children }: { children: ReactNode }) {
  return (
    <ComboboxTrigger
      className={cn(
        'group/select-trigger flex h-8 w-full items-center gap-0.5 rounded-lg border-0 bg-components-input-bg-normal py-2 ps-3 pe-2 text-start system-sm-regular text-components-input-text-filled',
        'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
        'data-placeholder:text-components-input-text-placeholder',
        'data-readonly:not-data-disabled:cursor-default data-readonly:not-data-disabled:bg-components-input-bg-normal data-readonly:not-data-disabled:hover:bg-components-input-bg-normal',
        'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled data-disabled:data-placeholder:text-components-input-text-disabled',
      )}
    >
      {/* oxlint-disable-next-line dify/require-title-for-truncated-text -- The picker exposes the full selected label in its options. */}
      <span className="min-w-0 grow truncate">{children}</span>
      <ComboboxIcon className="text-text-quaternary group-[:hover:not([data-disabled],[data-readonly])]/select-trigger:text-text-secondary data-popup-open:text-text-secondary" />
    </ComboboxTrigger>
  )
}
