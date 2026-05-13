'use client'

import type { FC, ReactNode } from 'react'
import type { AppListCategory } from './hooks/use-apps-query-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import { AppModeEnum } from '@/types/app'

type AppTypeOption = {
  value: AppListCategory
  text: string
  icon: ReactNode
}

type AppListHeaderFiltersProps = {
  category: AppListCategory
  tagIDs: string[]
  keywords: string
  isCreatedByMe: boolean
  onCategoryChange: (nextValue: string | null) => void
  onTagIDsChange: (tagIDs: string[]) => void
  onKeywordsChange: (keywords: string) => void
  onCreatedByMeChange: () => void
  onCreateBlank: () => void
  onCreateTemplate: () => void
  onImportDSL: () => void
  onOpenTagManagement: () => void
  showCreateButton: boolean
}

const AppListHeaderFilters: FC<AppListHeaderFiltersProps> = ({
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
}) => {
  const { t } = useTranslation()
  const options = useMemo<AppTypeOption[]>(() => [
    { value: 'all', text: t('types.all', { ns: 'app' }), icon: <span className="mr-1 i-ri-apps-2-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.WORKFLOW, text: t('types.workflow', { ns: 'app' }), icon: <span className="mr-1 i-ri-exchange-2-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.ADVANCED_CHAT, text: t('types.advanced', { ns: 'app' }), icon: <span className="mr-1 i-ri-message-3-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.CHAT, text: t('types.chatbot', { ns: 'app' }), icon: <span className="mr-1 i-ri-message-3-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.AGENT_CHAT, text: t('types.agent', { ns: 'app' }), icon: <span className="mr-1 i-ri-robot-3-line h-[14px] w-[14px]" /> },
    { value: AppModeEnum.COMPLETION, text: t('types.completion', { ns: 'app' }), icon: <span className="mr-1 i-ri-file-4-line h-[14px] w-[14px]" /> },
  ], [t])

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <div className="flex min-w-0 items-center gap-2">
        <Select
          value={category as string}
          onValueChange={onCategoryChange}
        >
          <SelectTrigger
            aria-label={t('types.label', { ns: 'app' })}
            className="w-auto shrink-0 gap-0 rounded-lg bg-components-input-bg-normal px-2 py-1 system-sm-regular text-text-tertiary hover:bg-components-input-bg-normal data-open:bg-components-input-bg-normal"
          >
            <span className="flex items-center gap-0">
              <span aria-hidden className="i-ri-apps-2-line size-4 shrink-0 p-0.5" />
              <span className="px-1">{t('types.label', { ns: 'app' })}</span>
            </span>
          </SelectTrigger>
          <SelectContent popupClassName="min-w-40" listClassName="p-1">
            {options.map(option => (
              <SelectItem
                key={option.value}
                value={option.value}
                onClick={() => onCategoryChange(option.value)}
              >
                {option.icon}
                <SelectItemText>{option.text}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TagFilter type="app" value={tagIDs} onChange={onTagIDsChange} onOpenTagManagement={onOpenTagManagement} />
        <Input
          showLeftIcon
          showClearIcon
          wrapperClassName="w-[200px]"
          value={keywords}
          onChange={e => onKeywordsChange(e.target.value)}
          onClear={() => onKeywordsChange('')}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex h-8 items-center gap-2 rounded-lg bg-components-input-bg-normal px-2 text-text-secondary">
          <Checkbox checked={isCreatedByMe} onCheck={onCreatedByMeChange} />
          <span className="system-sm-regular whitespace-nowrap">
            {t('showMyCreatedAppsOnly', { ns: 'app' })}
          </span>
        </label>
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
