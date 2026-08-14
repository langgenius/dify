'use client'

import { useLocale } from '@/context/i18n'
import { useActivePluginType, useSearchPluginText } from '../atoms'
import { MarketplaceSearchAutocomplete } from './marketplace-search-autocomplete'

type MarketplacePluginSearchProps = {
  placeholder: string
}

export default function MarketplacePluginSearch({ placeholder }: MarketplacePluginSearchProps) {
  const locale = useLocale()
  const [category] = useActivePluginType()
  const [value, setValue] = useSearchPluginText()

  return (
    <MarketplaceSearchAutocomplete
      category={category}
      locale={locale}
      onValueChange={(nextValue) => {
        void setValue(nextValue)
      }}
      placeholder={placeholder}
      scope="plugins"
      value={value}
    />
  )
}
