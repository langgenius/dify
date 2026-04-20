'use client'

import type { AppListCategory } from './app-type-filter-shared'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppModeEnum } from '@/types/app'
import { isAppListCategory } from './app-type-filter-shared'

const chipClassName = 'flex h-8 items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 text-[13px] leading-[18px] text-text-secondary hover:bg-components-input-bg-hover'

type AppTypeFilterProps = {
  activeTab: AppListCategory
  onChange: (value: AppListCategory) => void
}

const AppTypeFilter = ({
  activeTab,
  onChange,
}: AppTypeFilterProps) => {
  const { t } = useTranslation()

  const options = useMemo(() => ([
    { value: 'all', text: t('types.all', { ns: 'app' }), iconClassName: 'i-ri-apps-2-line' },
    { value: AppModeEnum.WORKFLOW, text: t('types.workflow', { ns: 'app' }), iconClassName: 'i-ri-exchange-2-line' },
    { value: AppModeEnum.ADVANCED_CHAT, text: t('types.advanced', { ns: 'app' }), iconClassName: 'i-ri-message-3-line' },
    { value: AppModeEnum.CHAT, text: t('types.chatbot', { ns: 'app' }), iconClassName: 'i-ri-message-3-line' },
    { value: AppModeEnum.AGENT_CHAT, text: t('types.agent', { ns: 'app' }), iconClassName: 'i-ri-robot-3-line' },
    { value: AppModeEnum.COMPLETION, text: t('types.completion', { ns: 'app' }), iconClassName: 'i-ri-file-4-line' },
  ]), [t])

  const activeOption = options.find(option => option.value === activeTab)
  const triggerLabel = activeTab === 'all' ? t('studio.filters.types', { ns: 'app' }) : activeOption?.text

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            className={cn(chipClassName, activeTab !== 'all' && 'shadow-xs')}
          />
        )}
      >
        <span aria-hidden className={cn('h-4 w-4 shrink-0 text-text-tertiary', activeOption?.iconClassName ?? 'i-ri-apps-2-line')} />
        <span>{triggerLabel}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" popupClassName="w-[220px]">
        <DropdownMenuRadioGroup value={activeTab} onValueChange={value => isAppListCategory(value) && onChange(value)}>
          {options.map(option => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span aria-hidden className={cn('h-4 w-4 shrink-0 text-text-tertiary', option.iconClassName)} />
              <span>{option.text}</span>
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AppTypeFilter
