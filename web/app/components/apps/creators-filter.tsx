'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileIdAtom } from '@/context/account-state'
import { useMembers } from '@/service/use-common'

type CreatorsFilterProps = {
  value: string[]
  onChange: (value: string[]) => void
}

type CreatorOption = {
  id: string
  name: string
  avatarUrl: string | null
  isYou: boolean
}

const baseChipClassName =
  'flex h-8 items-center whitespace-nowrap rounded-lg border-[0.5px] px-2 text-[13px] leading-4 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid'

const CreatorsFilter = ({ value, onChange }: CreatorsFilterProps) => {
  const { t } = useTranslation()
  const currentUserId = useAtomValue(userProfileIdAtom)
  const { data: membersData } = useMembers()
  const [keywords, setKeywords] = useState('')

  const creatorOptions = useMemo<CreatorOption[]>(() => {
    const members = membersData?.accounts ?? []

    return [...members]
      .filter((member) => member.status !== 'pending')
      .sort((left, right) => {
        if (left.id === currentUserId) return -1
        if (right.id === currentUserId) return 1
        return left.name.localeCompare(right.name)
      })
      .map((member) => ({
        id: member.id,
        name: member.name,
        avatarUrl: member.avatar_url,
        isYou: member.id === currentUserId,
      }))
  }, [currentUserId, membersData?.accounts])

  const filteredCreators = useMemo(() => {
    const normalizedKeywords = keywords.trim().toLowerCase()
    if (!normalizedKeywords) return creatorOptions

    return creatorOptions.filter((creator) => {
      const keyword = normalizedKeywords
      return creator.name.toLowerCase().includes(keyword)
    })
  }, [creatorOptions, keywords])

  const selectedCreators = useMemo(() => {
    const creatorMap = new Map(creatorOptions.map((creator) => [creator.id, creator]))
    return value
      .map((id) => creatorMap.get(id))
      .filter((creator): creator is CreatorOption => Boolean(creator))
  }, [creatorOptions, value])

  const toggleCreator = useCallback(
    (creatorId: string) => {
      if (value.includes(creatorId)) {
        onChange(value.filter((id) => id !== creatorId))
        return
      }

      onChange([...value, creatorId])
    },
    [onChange, value],
  )

  const resetCreators = useCallback(() => {
    onChange([])
    setKeywords('')
  }, [onChange])

  const selectedCount = value.length
  const selectedAvatarCreators = selectedCreators.slice(0, 3)
  const isSelected = selectedCount > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              baseChipClassName,
              isSelected
                ? 'border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-state-base-hover'
                : 'border-transparent bg-components-input-bg-normal text-text-tertiary hover:bg-components-input-bg-hover',
            )}
          />
        }
      >
        {!isSelected && (
          <>
            <span className="px-1 text-text-tertiary">
              {t(($) => $['studio.filters.creators'], { ns: 'app' })}
            </span>
            <span
              aria-hidden
              className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary"
            />
          </>
        )}
        {isSelected && (
          <>
            <span className="px-1 text-text-tertiary">
              {t(($) => $['studio.filters.creators'], { ns: 'app' })}
            </span>
            <span className="flex items-center pr-1">
              {selectedAvatarCreators.map((creator, index) => (
                <Avatar
                  key={creator.id}
                  avatar={creator.avatarUrl}
                  name={creator.name}
                  size="xs"
                  className={cn('border border-components-panel-bg', index > 0 && '-ml-1')}
                />
              ))}
            </span>
            <span className="text-xs leading-4 font-medium text-text-tertiary">{`+${selectedCount}`}</span>
            <span
              role="button"
              tabIndex={0}
              aria-label={t(($) => $['studio.filters.reset'], { ns: 'app' })}
              className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-xs text-text-quaternary outline-hidden hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={(event) => {
                event.stopPropagation()
                resetCreators()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return

                event.preventDefault()
                event.stopPropagation()
                resetCreators()
              }}
            >
              <span aria-hidden className="i-ri-close-circle-fill h-3.5 w-3.5" />
            </span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" popupClassName="w-[280px] p-0">
        <div className="flex items-center gap-1 p-2 pb-1">
          <div className="relative min-w-0 grow">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
            />
            <Input
              className={cn('pl-6.5', keywords && 'pr-6.5')}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t(($) => $['studio.filters.searchCreators'], { ns: 'app' })}
            />
            {!!keywords && (
              <button
                type="button"
                aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
                className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center text-components-input-text-placeholder hover:text-components-input-text-filled"
                onClick={() => setKeywords('')}
              >
                <span aria-hidden className="i-ri-close-circle-fill size-4" />
              </button>
            )}
          </div>
          {isSelected && (
            <button
              type="button"
              className="shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={resetCreators}
            >
              {t(($) => $['studio.filters.reset'], { ns: 'app' })}
            </button>
          )}
        </div>
        <div className="max-h-60 overflow-y-auto px-1 pb-1">
          {filteredCreators.map((creator) => {
            const checked = value.includes(creator.id)

            return (
              <button
                key={creator.id}
                type="button"
                className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => toggleCreator(creator.id)}
              >
                <Checkbox id={creator.id} checked={checked} className="shrink-0" />
                <div className="flex min-w-0 grow items-center gap-2 px-1">
                  <Avatar
                    avatar={creator.avatarUrl}
                    name={creator.name}
                    size="xs"
                    className="border-[0.5px] border-divider-regular"
                  />
                  <div className="flex min-w-0 grow items-center justify-between gap-2">
                    <span className="truncate text-sm text-text-secondary">{creator.name}</span>
                    {creator.isYou && (
                      <span className="shrink-0 text-sm text-text-quaternary">
                        {t(($) => $['studio.filters.you'], { ns: 'app' })}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default CreatorsFilter
