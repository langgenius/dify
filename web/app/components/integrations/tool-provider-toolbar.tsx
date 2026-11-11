'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { UpdateSettingDialog } from '@/app/components/header/account-setting/update-setting-dialog'
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
  const { t } = useTranslation(['plugin'])

  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-start gap-x-2 gap-y-2',
        frameClassName ? 'bg-components-panel-bg pt-2 pb-0' : 'w-full',
        frameClassName,
        currentProviderId && 'pe-6',
      )}
    >
      {!isRouteCategory && (
        <RadioGroup
          aria-label={t(($) => $['category.tools'], { ns: 'plugin' })}
          value={activeTab}
          onValueChange={onCategoryChange}
          className="gap-0"
        >
          {options.map((option) => (
            <RadioItem
              key={option.value}
              value={option.value}
              nativeButton
              render={<button type="button" />}
              className="relative me-1 flex h-8 min-w-0 touch-manipulation items-center justify-start rounded-lg border-[0.5px] border-transparent px-3 py-1.75 text-start text-[13px] leading-4.5 font-medium whitespace-normal text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-checked:border-components-main-nav-nav-button-border data-checked:bg-state-base-hover data-checked:text-components-main-nav-nav-button-text-active data-checked:shadow-xs data-checked:shadow-shadow-shadow-3"
            >
              {option.text}
            </RadioItem>
          ))}
        </RadioGroup>
      )}
      <div className="flex min-w-50 flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {showLabelFilter && <LabelFilter value={tagFilterValue} onChange={onTagsChange} />}
          <SearchInput className="w-50" value={keywords} onValueChange={onKeywordsChange} />
        </div>
        {toolbarAction}
        {!toolbarAction && showToolsUpdateSetting && (
          <UpdateSettingDialog category={PluginCategoryEnum.tool} />
        )}
      </div>
    </div>
  )
}
