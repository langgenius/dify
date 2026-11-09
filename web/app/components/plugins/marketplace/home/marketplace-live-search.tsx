'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useDebounce } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from '@/next/navigation'
import { markMarketplaceSiteSearch } from '@/utils/marketplace-site-track'

type MarketplaceLiveSearchProps = {
  action: string
  className?: string
  language?: string
  placeholder: string
  preserveParams?: {
    tags?: string[]
    languages?: string[]
  }
  query: string
}

export default function MarketplaceLiveSearch({
  action,
  className,
  language,
  placeholder,
  preserveParams,
  query,
}: MarketplaceLiveSearchProps) {
  const router = useRouter()
  const [value, setValue] = useState(query)
  const debouncedSearch = useDebounce(value.trim(), { wait: 300 })
  const routedSearchRef = useRef(query.trim())
  const navigate = useCallback(
    (nextQuery: string) => {
      if (nextQuery) markMarketplaceSiteSearch(nextQuery)
      const searchParams = new URLSearchParams()
      if (nextQuery) searchParams.set('q', nextQuery)
      if (language) searchParams.set('language', language)
      if (preserveParams?.tags?.length) searchParams.set('tags', preserveParams.tags.join(','))
      if (preserveParams?.languages?.length)
        searchParams.set('languages', preserveParams.languages.join(','))
      const queryString = searchParams.toString()

      router.replace(`${action}${queryString ? `?${queryString}` : ''}`, { scroll: false })
    },
    [action, language, preserveParams, router],
  )

  useEffect(() => {
    if (debouncedSearch === routedSearchRef.current) return

    routedSearchRef.current = debouncedSearch
    navigate(debouncedSearch)
  }, [debouncedSearch, navigate])

  return (
    <form
      action={action}
      className={cn('relative shrink-0', className)}
      onSubmit={(event) => {
        event.preventDefault()
        const nextQuery = value.trim()
        routedSearchRef.current = nextQuery
        navigate(nextQuery)
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
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-[10px] border border-transparent bg-components-input-bg-normal py-2 pr-3 pl-9 text-sm text-text-primary outline-none placeholder:text-text-quaternary hover:border-components-input-border-hover focus:border-components-input-border-active"
      />
      {language && <input type="hidden" name="language" value={language} />}
    </form>
  )
}
