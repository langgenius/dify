'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { marketplaceLinks } from './links'

export const useMarketplace = () => {
  const { data: enabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.enable_marketplace,
  })

  return enabled ? marketplaceLinks : null
}
