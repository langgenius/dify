'use client'

import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type { AppListCategory } from './app-type-filter-shared'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { getStepByStepTourDropdownMenuContentProps } from '@/app/components/step-by-step-tour/dropdown-menu'
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
  stepByStepTourCreateMenuOpen?: boolean
  stepByStepTourCreateMenuTarget?: string
  stepByStepTourCreateMenuHighlightPart?: string
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
  stepByStepTourCreateMenuOpen,
  stepByStepTourCreateMenuTarget,
  stepByStepTourCreateMenuHighlightPart,
}: AppListHeaderFiltersProps) {
  const { t } = useTranslation()
  const createMenuOpenProps = stepByStepTourCreateMenuOpen === undefined
    ? {}
    : {
        open: stepByStepTourCreateMenuOpen,
        onOpenChange: () => {},
      }

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
          aria-label={t('gotoAnything.actions.searchApplications', { ns: 'app' })}
        />
      </div>
      <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
        <Link
          href="/snippets"
          className="inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 text-[13px] leading-4 font-medium whitespace-nowrap text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-braces-line size-4 shrink-0" />
          {t('studio.viewSnippets', { ns: 'app' })}
        </Link>
        {showCreateButton && (
          <DropdownMenu modal={false} {...createMenuOpenProps}>
            <DropdownMenuTrigger
              render={(
                <Button
                  data-step-by-step-tour-target={stepByStepTourCreateMenuTarget}
                  variant="primary"
                  size="medium"
                  className="gap-0.5 px-2 whitespace-nowrap shadow-xs shadow-shadow-shadow-3"
                >
                  <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                  <span className="pl-1">{t('operation.create', { ns: 'common' })}</span>
                  <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
                </Button>
              )}
            />
            <DropdownMenuContent
              placement="bottom-end"
              sideOffset={4}
              {...getStepByStepTourDropdownMenuContentProps({
                highlightPart: stepByStepTourCreateMenuHighlightPart,
                popupClassName: 'w-70 p-0',
                presentationOnly: Boolean(stepByStepTourCreateMenuOpen),
              })}
            >
              <div className="py-1">
                <DropdownMenuItem
                  className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                  onClick={onCreateBlank}
                >
                  <span aria-hidden className="i-ri-sticky-note-add-line size-4 shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate px-1">{t('newApp.startFromBlank', { ns: 'app' })}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                  onClick={onCreateTemplate}
                >
                  <span aria-hidden className="i-ri-apps-2-add-line size-4 shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate px-1">{t('newApp.startFromTemplate', { ns: 'app' })}</span>
                </DropdownMenuItem>
              </div>
              <div className="h-px bg-divider-subtle" />
              <div className="py-1">
                <DropdownMenuItem
                  className={cn(
                    'h-auto items-start gap-1 rounded-lg px-2 py-1.5',
                    'hover:bg-state-base-hover focus:bg-state-base-hover',
                  )}
                  onClick={onImportDSL}
                >
                  <span className="flex h-5 shrink-0 items-center py-0.5">
                    <span aria-hidden className="i-ri-file-upload-line size-4 text-text-secondary" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-1">
                    <span className="system-md-regular text-text-secondary">{t('importDSL', { ns: 'app' })}</span>
                    <span className="system-xs-regular text-text-tertiary">{t('newApp.dropDSLToCreateApp', { ns: 'app' })}</span>
                  </span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
