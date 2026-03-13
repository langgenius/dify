'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { cn } from '@/utils/classnames'

type CreatorOption = {
  id: string
  name: string
  isYou?: boolean
  avatarClassName: string
}

const chipClassName = 'flex h-8 items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 text-[13px] leading-[18px] text-text-secondary hover:bg-components-input-bg-hover'

const creatorOptions: CreatorOption[] = [
  { id: 'evan', name: 'Evan', isYou: true, avatarClassName: 'bg-gradient-to-br from-[#ff9b3f] to-[#ff4d00]' },
  { id: 'jack', name: 'Jack', avatarClassName: 'bg-gradient-to-br from-[#fde68a] to-[#d6d3d1]' },
  { id: 'gigi', name: 'Gigi', avatarClassName: 'bg-gradient-to-br from-[#f9a8d4] to-[#a78bfa]' },
  { id: 'alice', name: 'Alice', avatarClassName: 'bg-gradient-to-br from-[#93c5fd] to-[#4f46e5]' },
  { id: 'mandy', name: 'Mandy', avatarClassName: 'bg-gradient-to-br from-[#374151] to-[#111827]' },
]

const CreatorsFilter = () => {
  const { t } = useTranslation()
  const [selectedCreatorIds, setSelectedCreatorIds] = useState<string[]>([])
  const [keywords, setKeywords] = useState('')

  const filteredCreators = useMemo(() => {
    const normalizedKeywords = keywords.trim().toLowerCase()
    if (!normalizedKeywords)
      return creatorOptions

    return creatorOptions.filter(creator => creator.name.toLowerCase().includes(normalizedKeywords))
  }, [keywords])

  const selectedCount = selectedCreatorIds.length
  const triggerLabel = selectedCount > 0
    ? `${t('studio.filters.creators', { ns: 'app' })} +${selectedCount}`
    : t('studio.filters.creators', { ns: 'app' })

  const toggleCreator = useCallback((creatorId: string) => {
    setSelectedCreatorIds((prev) => {
      if (prev.includes(creatorId))
        return prev.filter(id => id !== creatorId)
      return [...prev, creatorId]
    })
  }, [])

  const resetCreators = useCallback(() => {
    setSelectedCreatorIds([])
    setKeywords('')
  }, [])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            className={cn(chipClassName, selectedCount > 0 && 'border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs')}
          />
        )}
      >
        <span aria-hidden className="i-ri-user-shared-line h-4 w-4 shrink-0 text-text-tertiary" />
        <span>{triggerLabel}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" popupClassName="w-[280px] p-0">
        <div className="flex items-center gap-2 p-2 pb-1">
          <Input
            showLeftIcon
            showClearIcon
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            onClear={() => setKeywords('')}
            placeholder={t('studio.filters.searchCreators', { ns: 'app' })}
          />
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
            onClick={resetCreators}
          >
            {t('studio.filters.reset', { ns: 'app' })}
          </button>
        </div>
        <div className="px-1 pb-1">
          <DropdownMenuCheckboxItem
            checked={selectedCreatorIds.length === 0}
            onCheckedChange={resetCreators}
          >
            <span aria-hidden className="i-ri-user-line h-4 w-4 shrink-0 text-text-tertiary" />
            <span>{t('studio.filters.allCreators', { ns: 'app' })}</span>
            <DropdownMenuCheckboxItemIndicator />
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {filteredCreators.map(creator => (
            <DropdownMenuCheckboxItem
              key={creator.id}
              checked={selectedCreatorIds.includes(creator.id)}
              onCheckedChange={() => toggleCreator(creator.id)}
            >
              <span className={cn('h-5 w-5 shrink-0 rounded-full border border-white', creator.avatarClassName)} />
              <span className="flex min-w-0 grow items-center justify-between gap-2">
                <span className="truncate">{creator.name}</span>
                {creator.isYou && (
                  <span className="shrink-0 text-text-quaternary">{t('studio.filters.you', { ns: 'app' })}</span>
                )}
              </span>
              <DropdownMenuCheckboxItemIndicator />
            </DropdownMenuCheckboxItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default CreatorsFilter
