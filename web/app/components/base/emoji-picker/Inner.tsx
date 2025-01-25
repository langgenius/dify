'use client'
import type { ChangeEvent, FC } from 'react'
import React, { useState } from 'react'
import data from '@emoji-mart/data'
import type { EmojiMartData } from '@emoji-mart/data'
import { init } from 'emoji-mart'
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import cn from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import { searchEmoji } from '@/utils/emoji'

declare global {
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface IntrinsicElements {
      'em-emoji': React.DetailedHTMLProps< React.HTMLAttributes<HTMLElement>, HTMLElement >
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

  const [searchedEmojis, setSearchedEmojis] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)

  React.useEffect(() => {
    if (selectedEmoji && selectedBackground)
      onSelect?.(selectedEmoji, selectedBackground)
  }, [onSelect, selectedEmoji, selectedBackground])

  return <div className={cn(className)}>
    <div className='flex flex-col items-center w-full px-3 pb-2'>
      <div className="relative w-full">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <MagnifyingGlassIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
        </div>
        <input
          type="search"
          id="search"
          className='block w-full h-10 px-3 pl-10 text-sm font-normal bg-gray-100 rounded-lg'
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
    <Divider className='m-0 mb-3' />

    <div className="w-full max-h-[200px] overflow-x-hidden overflow-y-auto px-3">
      {isSearching && <>
        <div key={'category-search'} className='flex flex-col'>
          <p className='font-medium uppercase text-xs text-[#101828] mb-1'>Search</p>
          <div className='w-full h-full grid grid-cols-8 gap-1'>
            {searchedEmojis.map((emoji: string, index: number) => {
              return <div
                key={`emoji-search-${index}`}
                className='inline-flex w-10 h-10 rounded-lg items-center justify-center'
                onClick={() => {
                  setSelectedEmoji(emoji)
                }}
              >
                <div className='cursor-pointer w-8 h-8 p-1 flex items-center justify-center rounded-lg hover:ring-1 ring-offset-1 ring-gray-300'>
                  <em-emoji id={emoji} />
                </div>
              </div>
            })}
          </div>
        </div>
      </>}

      {categories.map((category, index: number) => {
        return <div key={`category-${index}`} className='flex flex-col'>
          <p className='font-medium uppercase text-xs text-[#101828] mb-1'>{category.id}</p>
          <div className='w-full h-full grid grid-cols-8 gap-1'>
            {category.emojis.map((emoji, index: number) => {
              return <div
                key={`emoji-${index}`}
                className='inline-flex w-10 h-10 rounded-lg items-center justify-center'
                onClick={() => {
                  setSelectedEmoji(emoji)
                }}
              >
                <div className='cursor-pointer w-8 h-8 p-1 flex items-center justify-center rounded-lg hover:ring-1 ring-offset-1 ring-gray-300'>
                  <em-emoji id={emoji} />
                </div>
              </div>
            })}

          </div>
        </div>
      })}
    </div>

    {/* Color Select */}
    <div className={cn('p-3 pb-0', selectedEmoji === '' ? 'opacity-25' : '')}>
      <p className='font-medium uppercase text-xs text-[#101828] mb-2'>Choose Style</p>
      <div className='w-full h-full grid grid-cols-8 gap-1'>
        {backgroundColors.map((color) => {
          return <div
            key={color}
            className={
              cn(
                'cursor-pointer',
                'hover:ring-1 ring-offset-1',
                'inline-flex w-10 h-10 rounded-lg items-center justify-center',
                color === selectedBackground ? 'ring-1 ring-gray-300' : '',
              )}
            onClick={() => {
              setSelectedBackground(color)
            }}
          >
            <div className={cn(
              'w-8 h-8 p-1 flex items-center justify-center rounded-lg',
            )
            } style={{ background: color }}>
              {selectedEmoji !== '' && <em-emoji id={selectedEmoji} />}
            </div>
          </div>
        })}
      </div>
    </div>
  </div>
}
export default EmojiPickerInner
