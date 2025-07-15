'use client'
import type { ChangeEvent, FC } from 'react'
import React, { useState } from 'react'
import data from '@emoji-mart/data'
import type { EmojiMartData } from '@emoji-mart/data'
import { init } from 'emoji-mart'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import Input from '@/app/components/base/input'
import Divider from '@/app/components/base/divider'
import { searchEmoji } from '@/utils/emoji'
import cn from '@/utils/classnames'

declare global {
  // eslint-disable-next-line ts/no-namespace
  namespace JSX {
    // eslint-disable-next-line ts/consistent-type-definitions
    interface IntrinsicElements {
      'em-emoji': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

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
  onSelect,
  className,
}) => {
  const { categories } = data as EmojiMartData
  const [selectedEmoji, setSelectedEmoji] = useState('')
  const [selectedBackground, setSelectedBackground] = useState(backgroundColors[0])
  const [showStyleColors, setShowStyleColors] = useState(false)

  const [searchedEmojis, setSearchedEmojis] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)

  React.useEffect(() => {
    if (selectedEmoji) {
      setShowStyleColors(true)
      if (selectedBackground)
        onSelect?.(selectedEmoji, selectedBackground)
    }
  }, [onSelect, selectedEmoji, selectedBackground])

  return <div className={cn(className, 'flex flex-col')}>
    <div className='flex w-full flex-col items-center px-3 pb-2'>
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
    <Divider className='my-3' />

    <div className="max-h-[200px] w-full overflow-y-auto overflow-x-hidden px-3">
      {isSearching && <>
        <div key={'category-search'} className='flex flex-col'>
          <p className='system-xs-medium-uppercase mb-1 text-text-primary'>Search</p>
          <div className='grid h-full w-full grid-cols-8 gap-1'>
            {searchedEmojis.map((emoji: string, index: number) => {
              return <div
                key={`emoji-search-${index}`}
                className='inline-flex h-10 w-10 items-center justify-center rounded-lg'
                onClick={() => {
                  setSelectedEmoji(emoji)
                }}
              >
                <div className='flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg p-1 ring-components-input-border-hover ring-offset-1 hover:ring-1'>
                  <em-emoji id={emoji} />
                </div>
              </div>
            })}
          </div>
        </div>
      </>}

      {categories.map((category, index: number) => {
        return <div key={`category-${index}`} className='flex flex-col'>
          <p className='system-xs-medium-uppercase mb-1 text-text-primary'>{category.id}</p>
          <div className='grid h-full w-full grid-cols-8 gap-1'>
            {category.emojis.map((emoji, index: number) => {
              return <div
                key={`emoji-${index}`}
                className='inline-flex h-10 w-10 items-center justify-center rounded-lg'
                onClick={() => {
                  setSelectedEmoji(emoji)
                }}
              >
                <div className='flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg p-1 ring-components-input-border-hover ring-offset-1 hover:ring-1'>
                  <em-emoji id={emoji} />
                </div>
              </div>
            })}

          </div>
        </div>
      })}
    </div>

    {/* Color Select */}
    <div className={cn('flex items-center justify-between p-3 pb-0')}>
      <p className='system-xs-medium-uppercase mb-2 text-text-primary'>Choose Style</p>
      {showStyleColors ? <ChevronDownIcon className='h-4 w-4' onClick={() => setShowStyleColors(!showStyleColors)} /> : <ChevronUpIcon className='h-4 w-4' onClick={() => setShowStyleColors(!showStyleColors)} />}
    </div>
    {showStyleColors && <div className='grid w-full grid-cols-8 gap-1 px-3'>
      {backgroundColors.map((color) => {
        return <div
          key={color}
          className={
            cn(
              'cursor-pointer',
              'ring-offset-1 hover:ring-1',
              'inline-flex h-10 w-10 items-center justify-center rounded-lg',
              color === selectedBackground ? 'ring-1 ring-components-input-border-hover' : '',
            )}
          onClick={() => {
            setSelectedBackground(color)
          }}
        >
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg p-1',
          )
          } style={{ background: color }}>
            {selectedEmoji !== '' && <em-emoji id={selectedEmoji} />}
          </div>
        </div>
      })}
    </div>}
  </div>
}
export default EmojiPickerInner
