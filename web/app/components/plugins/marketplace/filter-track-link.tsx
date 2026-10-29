'use client'

import type { ComponentProps } from 'react'
import Link from '@/next/link'
import { markMarketplaceSiteFilter } from '@/utils/marketplace-site-track'

type MarketplaceFilterTrackLinkProps = ComponentProps<typeof Link> & {
  filterValue: string
  filterType: 'type_tab' | 'category' | 'language'
  selectedValues: string[]
  selectionMode?: 'single' | 'multi'
  trackFilter?: boolean
}

export default function MarketplaceFilterTrackLink({
  filterValue,
  filterType,
  selectedValues,
  selectionMode = 'single',
  trackFilter = true,
  onClick,
  ...props
}: MarketplaceFilterTrackLinkProps) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        if (trackFilter) {
          markMarketplaceSiteFilter({
            filter_type: filterType,
            selection_mode: selectionMode,
            filter_value: filterValue,
            selected_values: selectedValues,
          })
        }
        onClick?.(event)
      }}
    />
  )
}
