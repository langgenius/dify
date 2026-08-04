'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { useLocale } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { Banner } from './banner'

export function HomeBanner() {
  const locale = useLocale()
  const { data: banners } = useSuspenseQuery(
    consoleQuery.explore.banners.get.queryOptions({
      input: { query: { language: locale } },
    }),
  )

  return <Banner banners={banners} />
}
