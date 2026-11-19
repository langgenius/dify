import type { ReactNode } from 'react'
import { ComboboxIcon, ComboboxTrigger } from '@langgenius/dify-ui/combobox'

export function PreferenceComboboxTrigger({ children }: { children: ReactNode }) {
  return (
    <ComboboxTrigger className="flex h-8 w-full min-w-0 items-center gap-0.5 rounded-lg border border-transparent bg-components-input-bg-normal ps-3 pe-2 text-start system-sm-regular text-components-input-text-filled hover:border-components-input-border-hover hover:bg-components-input-bg-hover data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-placeholder:text-components-input-text-placeholder data-popup-open:bg-components-input-bg-active data-readonly:hover:border-transparent data-readonly:hover:bg-components-input-bg-normal">
      {/* oxlint-disable-next-line dify/require-title-for-truncated-text -- The picker exposes the full selected label in its options. */}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ComboboxIcon className="mx-0.5" />
    </ComboboxTrigger>
  )
}
