'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { SearchInput } from '@/app/components/base/search-input'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import UpdateSettingDialog from '@/app/components/header/account-setting/update-setting-dialog'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import LabelFilter from '@/app/components/tools/labels/filter'

type ToolProviderToolbarOption = {
  value: string
  text: string
}

export function ToolProviderToolbar({
  activeTab,
  currentProviderId,
  frameClassName,
  isRouteCategory,
  keywords,
  options,
  showLabelFilter,
  showToolsUpdateSetting,
  tagFilterValue,
  toolbarAction,
  onCategoryChange,
  onKeywordsChange,
  onTagsChange,
}: {
  activeTab: string
  currentProviderId?: string
  frameClassName?: string
  isRouteCategory: boolean
  keywords: string
  options: ToolProviderToolbarOption[]
  showLabelFilter: boolean
  showToolsUpdateSetting: boolean
  tagFilterValue: string[]
  toolbarAction?: ReactNode
  onCategoryChange: (category: string) => void
  onKeywordsChange: (keywords: string) => void
  onTagsChange: (tags: string[]) => void
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-start gap-x-2 gap-y-2',
        frameClassName ? 'bg-components-panel-bg pt-2 pb-0' : 'w-full',
        frameClassName,
        currentProviderId && 'pr-6',
      )}
    >
      {!isRouteCategory && (
        <TabSliderNew
          value={activeTab}
          onChange={onCategoryChange}
          options={options}
        />
      )}
      <div className="flex min-w-[200px] flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {showLabelFilter && (
            <LabelFilter value={tagFilterValue} onChange={onTagsChange} />
          )}
          <SearchInput
            className="w-[200px]"
            value={keywords}
            onValueChange={onKeywordsChange}
          />
        </div>
        {toolbarAction}
        {!toolbarAction && showToolsUpdateSetting && (
          <UpdateSettingDialog
            category={PluginCategoryEnum.tool}
          />
        )}
      </div>
    </div>
  )
}
