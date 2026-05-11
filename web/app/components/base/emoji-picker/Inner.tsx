'use client'
import type { EmojiMartData } from '@emoji-mart/data'
import type { ChangeEvent, FC } from 'react'
import data from '@emoji-mart/data'
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@langgenius/dify-ui/cn'
import { init } from 'emoji-mart'
import * as React from 'react'
import { useState } from 'react'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { searchEmoji } from '@/utils/emoji'

init({ data })

const backgroundColors = [
  '#FFEAD5',
  '#E4FBCC',
  '#D3F8DF',
  '#E0F2FE',

  '#E0EAFF',
  '#EFF1F5',
  '#FBE8FF',
  '#FCE7F6',

  '#FEF7C3',
  '#E6F4D7',
  '#D5F5F6',
  '#D1E9FF',

  '#D1E0FF',
  '#D5D9EB',
  '#ECE9FE',
  '#FFE4E8',
]

type IEmojiPickerInnerProps = {
  emoji?: string
  background?: string
  onSelect?: (emoji: string, background: string) => void
  className?: string
}

const EmojiPickerInner: FC<IEmojiPickerInnerProps> = ({
  emoji,
  background,
  onSelect,
  className,
}) => {
  const { categories } = data as EmojiMartData
  const [selectedEmoji, setSelectedEmoji] = useState(emoji || '')
  const [selectedBackground, setSelectedBackground] = useState(background || backgroundColors[0])
  const [showStyleColors, setShowStyleColors] = useState(!!emoji)

  const [searchedEmojis, setSearchedEmojis] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const styleColorsLabelId = React.useId()

  React.useEffect(() => {
    if (selectedEmoji) {
      /* v8 ignore next 2 - @preserve */
      if (selectedBackground)
        onSelect?.(selectedEmoji, selectedBackground)
    }
  }, [onSelect, selectedEmoji, selectedBackground])

  return (
    <div className={cn(className, 'flex flex-col')}>
      <div className="flex w-full flex-col items-center px-3 pb-2">
        <div className="relative w-full">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-text-quaternary" aria-hidden="true" />
          </div>
          <Input
            className="pl-10"
            type="search"
            id="search"
            placeholder="Search emojis..."
            onChange={async (e: ChangeEvent<HTMLInputElement>) => {
              if (e.target.value === '') {
                setIsSearching(false)
              }
              else {
                setIsSearching(true)
                const emojis = await searchEmoji(e.target.value)
                setSearchedEmojis(emojis)
              }
            }}
          />
        </div>
      </div>
      <Divider className="my-3" />

      <div className="max-h-[200px] w-full overflow-x-hidden overflow-y-auto px-3">
        {isSearching && (
          <>
            <div key="category-search" className="flex flex-col">
              <p className="mb-1 system-xs-medium-uppercase text-text-primary">Search</p>
              <div className="grid h-full w-full grid-cols-8 gap-1">
                {searchedEmojis.map((emoji: string, index: number) => {
                  return (
                    <button
                      type="button"
                      key={`emoji-search-${index}`}
                      aria-label={emoji}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border-none bg-transparent p-0"
                      onClick={() => {
                        setSelectedEmoji(emoji)
                        setShowStyleColors(true)
                      }}
                    >
                      <span className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg p-1 ring-components-input-border-hover ring-offset-1 hover:ring-1">
                        <em-emoji id={emoji} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {categories.map((category, index: number) => {
          return (
            <div key={`category-${index}`} className="flex flex-col">
              <p className="mb-1 system-xs-medium-uppercase text-text-primary">{category.id}</p>
              <div className="grid h-full w-full grid-cols-8 gap-1">
                {category.emojis.map((emoji, index: number) => {
                  return (
                    <button
                      type="button"
                      key={`emoji-${index}`}
                      aria-label={emoji}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border-none bg-transparent p-0"
                      onClick={() => {
                        setSelectedEmoji(emoji)
                        setShowStyleColors(true)
                      }}
                    >
                      <span className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg p-1 ring-components-input-border-hover ring-offset-1 hover:ring-1">
                        <em-emoji id={emoji} />
                      </span>
                    </button>
                  )
                })}

              </div>
            </div>
          )
        })}
      </div>

      {/* Color Select */}
      <div className={cn('flex items-center justify-between p-3 pb-0')}>
        <p id={styleColorsLabelId} className="mb-2 system-xs-medium-uppercase text-text-primary">Choose Style</p>
        {showStyleColors
          ? (
              <button
                type="button"
                aria-labelledby={styleColorsLabelId}
                aria-expanded="true"
                className="i-heroicons-chevron-down h-4 w-4 cursor-pointer border-none bg-transparent p-0 text-text-quaternary"
                onClick={() => setShowStyleColors(!showStyleColors)}
              />
            )
          : (
              <button
                type="button"
                aria-labelledby={styleColorsLabelId}
                aria-expanded="false"
                className="i-heroicons-chevron-up h-4 w-4 cursor-pointer border-none bg-transparent p-0 text-text-quaternary"
                onClick={() => setShowStyleColors(!showStyleColors)}
              />
            )}
      </div>
      {showStyleColors && (
        <div className="grid w-full grid-cols-8 gap-1 px-3">
          {backgroundColors.map((color) => {
            return (
              <button
                type="button"
                key={color}
                aria-label={color}
                className={
                  cn(
                    'cursor-pointer',
                    'border-none bg-transparent p-0',
                    'ring-components-input-border-hover ring-offset-1 hover:ring-1',
                    'inline-flex h-10 w-10 items-center justify-center rounded-lg',
                    color === selectedBackground ? 'ring-1 ring-components-input-border-hover' : '',
                  )
                }
                onClick={() => {
                  setSelectedBackground(color)
                }}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg p-1',
                  )}
                  style={{ background: color }}
                >
                  {selectedEmoji !== '' && <em-emoji id={selectedEmoji} />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
export default EmojiPickerInner
