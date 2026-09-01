'use client'

import { useSearchPluginText } from '../atoms'

type MarketplacePluginSearchProps = {
  placeholder: string
}

export default function MarketplacePluginSearch({ placeholder }: MarketplacePluginSearchProps) {
  const [value, setValue] = useSearchPluginText()

  return (
    <form
      className="relative w-full shrink-0"
      onSubmit={(event) => {
        event.preventDefault()
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary"
      />
      <input
        type="search"
        name="q"
        autoComplete="off"
        aria-label={placeholder}
        value={value}
        onChange={(event) => {
          void setValue(event.target.value)
        }}
        placeholder={placeholder}
        className="h-9 w-full rounded-[10px] border border-transparent bg-components-input-bg-normal py-2 pr-3 pl-9 text-sm text-text-primary outline-none placeholder:text-text-quaternary hover:border-components-input-border-hover focus:border-components-input-border-active"
      />
    </form>
  )
}
