'use client'

import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useQueryState } from 'nuqs'
import { Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ErrorBoundary from '@/app/components/base/error-boundary'
import AppCard from '@/app/components/explore/app-card'
import { useLocale } from '@/context/i18n'
import { ExploreAppListHeader } from './explore-app-list-header'
import { getHomeTemplatesQueryOptions } from './home-queries-client'
import { TemplatesSkeleton } from './loading-skeletons'
import s from './style.module.css'
import { useRevealDeadline } from './use-middle-reveal-deadline'

type TemplatesSectionProps = {
  canCreate: boolean
  canReveal: boolean
  onCreate: (app: App) => void
  onTry: (params: TryAppSelection) => void
}

function TemplatesErrorState({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <section className="px-8 pt-4 pb-6" aria-labelledby="templates-error-title">
      <div
        role="alert"
        className="flex min-h-12 items-center justify-between gap-4 rounded-xl bg-background-section px-4 py-3"
      >
        <div className="min-w-0">
          <h2 id="templates-error-title" className="truncate system-sm-medium text-text-secondary">
            {t(($) => $['apps.title'], { ns: 'explore' })}
          </h2>
          <p className="system-xs-regular text-text-tertiary">
            {t(($) => $['errorBoundary.title'], { ns: 'common' })}
          </p>
        </div>
        <Button size="small" variant="secondary" loading={isRetrying} onClick={onRetry}>
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </div>
    </section>
  )
}

function TemplatesLoadingFallback() {
  const { t } = useTranslation()
  const locale = useLocale()
  const templatesQuery = useQuery(getHomeTemplatesQueryOptions(locale))
  const isWithinRevealDeadline = useRevealDeadline(templatesQuery.isPending)

  if (isWithinRevealDeadline) return <TemplatesSkeleton />

  return (
    <section className="px-8 pt-4 pb-6" aria-labelledby="templates-loading-title">
      <div
        role="status"
        aria-live="polite"
        aria-label={t(($) => $.loading, { ns: 'common' })}
        className="flex min-h-12 items-center justify-between gap-4 rounded-xl bg-background-section px-4 py-3"
      >
        <div className="min-w-0">
          <h2
            id="templates-loading-title"
            className="truncate system-sm-medium text-text-secondary"
          >
            {t(($) => $['apps.title'], { ns: 'explore' })}
          </h2>
          <p className="system-xs-regular text-text-tertiary">
            {t(($) => $.loading, { ns: 'common' })}
          </p>
        </div>
      </div>
    </section>
  )
}

function TemplatesContent({
  canCreate,
  canReveal,
  keywords,
  searchKeywords,
  onCreate,
  onKeywordsChange,
  onTry,
}: TemplatesSectionProps & {
  keywords: string
  searchKeywords: string
  onKeywordsChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const locale = useLocale()
  const { data: templates } = useSuspenseQuery(getHomeTemplatesQueryOptions(locale))
  const allCategoriesEn = t(($) => $['apps.allCategories'], { ns: 'explore', lng: 'en' })

  const [currCategory, setCurrCategory] = useQueryState('category', {
    defaultValue: allCategoriesEn,
  })

  const visibleCategories = useMemo(() => {
    const categoriesWithApps = new Set<string>()
    templates.allList.forEach((app) => {
      app.categories.forEach((category) => categoriesWithApps.add(category))
    })

    return templates.categories.filter((category) => categoriesWithApps.has(category))
  }, [templates])

  const activeCategory = visibleCategories.includes(currCategory) ? currCategory : allCategoriesEn

  const filteredList = useMemo(
    () =>
      templates.allList.filter(
        (item) => activeCategory === allCategoriesEn || item.categories?.includes(activeCategory),
      ),
    [templates, activeCategory, allCategoriesEn],
  )

  const searchFilteredList = useMemo(() => {
    if (!searchKeywords || filteredList.length === 0) return filteredList

    const lowerCaseSearchKeywords = searchKeywords.toLowerCase()

    return filteredList.filter(
      (item) =>
        item.app && item.app.name && item.app.name.toLowerCase().includes(lowerCaseSearchKeywords),
    )
  }, [searchKeywords, filteredList])

  if (!canReveal) return <TemplatesSkeleton />

  return (
    <>
      <ExploreAppListHeader
        allCategoriesEn={allCategoriesEn}
        categories={visibleCategories}
        currCategory={activeCategory}
        keywords={keywords}
        onCategoryChange={setCurrCategory}
        onKeywordsChange={onKeywordsChange}
      />

      <div className={cn('relative flex flex-1 shrink-0 grow flex-col pb-6')}>
        <nav className={cn(s.appList, 'grid shrink-0 content-start gap-3 px-8')}>
          {searchFilteredList.map((app) => (
            <AppCard
              key={app.app_id}
              app={app}
              canCreate={canCreate}
              onCreate={() => onCreate(app)}
              onTry={onTry}
            />
          ))}
        </nav>
      </div>
    </>
  )
}

export function TemplatesSection(props: TemplatesSectionProps) {
  const locale = useLocale()
  const templatesQuery = useQuery(getHomeTemplatesQueryOptions(locale))
  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(
    () => {
      setSearchKeywords(keywords)
    },
    { wait: 500 },
  )
  const isTemplatesError =
    templatesQuery.isError || (!templatesQuery.isPending && !templatesQuery.data)

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  if (isTemplatesError) {
    if (!props.canReveal) return <TemplatesSkeleton />

    return (
      <TemplatesErrorState
        isRetrying={templatesQuery.isFetching}
        onRetry={() => void templatesQuery.refetch()}
      />
    )
  }

  return (
    <ErrorBoundary
      enableRecovery={false}
      resetKeys={[props.canReveal ? 1 : 0, templatesQuery.dataUpdatedAt]}
      fallback={(_, reset) =>
        props.canReveal ? (
          <TemplatesErrorState
            isRetrying={templatesQuery.isFetching}
            onRetry={() => {
              void templatesQuery.refetch().then(reset)
            }}
          />
        ) : (
          <TemplatesSkeleton />
        )
      }
    >
      <Suspense fallback={<TemplatesLoadingFallback />}>
        <TemplatesContent
          {...props}
          keywords={keywords}
          searchKeywords={searchKeywords}
          onKeywordsChange={handleKeywordsChange}
        />
      </Suspense>
    </ErrorBoundary>
  )
}
