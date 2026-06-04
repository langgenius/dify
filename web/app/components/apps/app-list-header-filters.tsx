'use client'

import type { AppListCategory } from './hooks/use-apps-query-state'
import type { Item } from '@/app/components/base/chip'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import SearchInput from '@/app/components/base/search-input'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import { AppModeEnum } from '@/types/app'

type AppTypeChipValue = Exclude<AppListCategory, 'all'> | ''

type AppListHeaderFiltersProps = {
  category: AppListCategory
  tagIDs: string[]
  keywords: string
  isCreatedByMe: boolean
  onCategoryChange: (nextValue: string | null) => void
  onTagIDsChange: (tagIDs: string[]) => void
  onKeywordsChange: (keywords: string) => void
  onCreatedByMeChange: (checked: boolean) => void
  onCreateBlank: () => void
  onCreateTemplate: () => void
  onImportDSL: () => void
  onOpenTagManagement: () => void
  showCreateButton: boolean
}

function AppListHeaderFilters({
  category,
  tagIDs,
  keywords,
  isCreatedByMe,
  onCategoryChange,
  onTagIDsChange,
  onKeywordsChange,
  onCreatedByMeChange,
  onCreateBlank,
  onCreateTemplate,
  onImportDSL,
  onOpenTagManagement,
  showCreateButton,
}: AppListHeaderFiltersProps) {
  const { t } = useTranslation()
  const appTypeItems = useMemo<Item<AppTypeChipValue>[]>(() => [
    { value: '', name: t('types.all', { ns: 'app' }) },
    { value: AppModeEnum.WORKFLOW, name: t('types.workflow', { ns: 'app' }) },
    { value: AppModeEnum.ADVANCED_CHAT, name: t('types.advanced', { ns: 'app' }) },
    { value: AppModeEnum.CHAT, name: t('types.chatbot', { ns: 'app' }) },
    { value: AppModeEnum.AGENT_CHAT, name: t('types.agent', { ns: 'app' }) },
    { value: AppModeEnum.COMPLETION, name: t('types.completion', { ns: 'app' }) },
  ], [t])
  const appTypeValue: AppTypeChipValue = category === 'all' ? '' : category

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Chip
          value={appTypeValue}
          items={appTypeItems}
          leftIcon={<span aria-hidden className="i-ri-apps-2-line block size-3.5 text-text-tertiary" />}
          className="[&_.system-sm-regular]:text-text-secondary"
          panelClassName="rounded-lg"
          onSelect={item => onCategoryChange(item.value || 'all')}
          onClear={() => onCategoryChange('all')}
        />
        <TagFilter type="app" value={tagIDs} onChange={onTagIDsChange} onOpenTagManagement={onOpenTagManagement} />
        <SearchInput
          className="w-50"
          value={keywords}
          onChange={onKeywordsChange}
        />
        <div className="h-3.5 w-px bg-divider-regular" />
        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg bg-components-input-bg-normal px-2 text-text-secondary">
          <Checkbox checked={isCreatedByMe} onCheckedChange={onCreatedByMeChange} />
          <span className="system-sm-regular whitespace-nowrap">
            {t('showMyCreatedAppsOnly', { ns: 'app' })}
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        {showCreateButton && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={(
                <Button
                  variant="primary"
                  size="medium"
                  className="gap-0.5 px-2 shadow-xs shadow-shadow-shadow-3"
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
              popupClassName="w-70 p-0"
            >
              <div className="p-1">
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
              <div className="p-1">
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

export default AppListHeaderFilters
