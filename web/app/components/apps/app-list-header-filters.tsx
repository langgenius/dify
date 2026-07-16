'use client'

import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type { AppListCategory } from './app-type-filter-shared'
import { useTranslation } from 'react-i18next'
import { CreateAppDropdown } from '@/app/components/app/create-app-dropdown'
import { SearchInput } from '@/app/components/base/search-input'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import Link from '@/next/link'
import { AppSortFilter } from './app-sort-filter'
import { AppTypeFilter } from './app-type-filter'
import CreatorsFilter from './creators-filter'

type AppListQuery = NonNullable<GetAppsData['query']>
type AppListSortBy = NonNullable<AppListQuery['sort_by']>

type AppListHeaderFiltersProps = {
  category: AppListCategory
  tagIDs: string[]
  keywords: string
  creatorIDs: string[]
  sortBy: AppListSortBy
  onCategoryChange: (category: AppListCategory) => void
  onTagIDsChange: (tagIDs: string[]) => void
  onKeywordsChange: (keywords: string) => void
  onCreatorIDsChange: (creatorIDs: string[]) => void
  onSortByChange: (sortBy: AppListSortBy) => void
  onCreateBlank: () => void
  onCreateTemplate: () => void
  onImportDSL: () => void
  onOpenTagManagement: () => void
  showCreateButton: boolean
}

export function AppListHeaderFilters({
  category,
  tagIDs,
  keywords,
  creatorIDs,
  sortBy,
  onCategoryChange,
  onTagIDsChange,
  onKeywordsChange,
  onCreatorIDsChange,
  onSortByChange,
  onCreateBlank,
  onCreateTemplate,
  onImportDSL,
  onOpenTagManagement,
  showCreateButton,
}: AppListHeaderFiltersProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <AppTypeFilter value={category} onChange={onCategoryChange} />
        <TagFilter
          type="app"
          value={tagIDs}
          onChange={onTagIDsChange}
          onOpenTagManagement={onOpenTagManagement}
          showLeadingIcon={false}
          triggerClassName="min-w-0"
        />
        <CreatorsFilter value={creatorIDs} onChange={onCreatorIDsChange} />
        <AppSortFilter value={sortBy} onChange={onSortByChange} />
        <SearchInput
          className="w-50 max-w-full"
          value={keywords}
          onValueChange={onKeywordsChange}
          aria-label={t(($) => $['gotoAnything.actions.searchApplications'], { ns: 'app' })}
        />
      </div>
      <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
        <Link
          href="/snippets"
          className="inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 text-[13px] leading-4 font-medium whitespace-nowrap text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-braces-line size-4 shrink-0" />
          {t(($) => $['studio.viewSnippets'], { ns: 'app' })}
        </Link>
        {showCreateButton && (
          <CreateAppDropdown
            onCreateBlank={onCreateBlank}
            onCreateTemplate={onCreateTemplate}
            onImportDSL={onImportDSL}
          />
        )}
      </div>
    </div>
  )
}
