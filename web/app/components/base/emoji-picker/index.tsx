'use client'
import data from '@emoji-mart/data'
import { init } from 'emoji-mart'
// import AppIcon from '@/app/components/base/app-icon'
import cn from 'classnames'
import Divider from '@/app/components/base/divider'

import Button from '@/app/components/base/button'
import s from './style.module.css'
import { useState, FC } from 'react'
import {
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline'
import React from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'em-emoji': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
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

interface IColorSelectProps {
  selectedEmoji: string
  onSelect: (color: string) => void
}
const ColorSelect: FC<IColorSelectProps> = (
  { selectedEmoji, onSelect }
) => {
  const [selectBackground, setSelectBackground] = useState(backgroundColors[0]);
  return <div className='flex flex-col p-3'>

    <p className='font-medium uppercase text-xs text-[#101828] mb-2'>Choose Style</p>
    <div className='w-full h-full grid grid-cols-8 gap-1'>
      {backgroundColors.map((color) => {
        return <div
          key={color}
          className={
            cn(
              'cursor-pointer',
              `ring-[${color}] hover:ring-1 ring-offset-1`,
              'inline-flex w-10 h-10 rounded-lg items-center justify-center',
              color === selectBackground ? `ring-1 ` : '',
            )}
          onClick={() => {
            setSelectBackground(color)
            onSelect(color)
          }}
        >
          <div className={cn(
            'w-8 h-8 p-1 flex items-center justify-center rounded-lg',
          )
          } style={{ background: color }}>
            <em-emoji id={selectedEmoji} />
          </div>
        </div>
      })}
    </div>
  </div>
}
interface IEmojiSelectProps {
  onSelect?: (emoji: any) => void
}

const EmojiSelect: FC<IEmojiSelectProps> = ({
  onSelect
}) => {

  const { categories, emojis } = data as any
  console.log(categories, emojis);
  return <div className="w-full max-h-[200px] overflow-x-hidden overflow-y-auto px-3">
    {categories.map((category: any) => {
      return <div key={category.id} className='flex flex-col'>
        <p className='font-medium uppercase text-xs text-[#101828] mb-1'>{category.id}</p>
        <div className='w-full h-full grid grid-cols-8 gap-1'>
          {category.emojis.map((emoji: any) => {
            return <div
              key={emoji}
              className='inline-flex w-10 h-10 rounded-lg items-center justify-center'
              onClick={() => {
                onSelect && onSelect(emoji)
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
}

interface IEmojiPickerProps {
  onSelect?: (emoji: string, background: string) => void
}
const EmojiPicker: FC<IEmojiPickerProps> = ({
  onSelect
}) => {
  const [selectedEmoji, setSelectedEmoji] = useState('')
  const [selectBackground, setSelectBackground] = useState('')

  const Elem = () => {
    return <div className={cn(s.container, 'bg-white')} >
      <div className='flex flex-col items-center w-full p-3'>
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <MagnifyingGlassIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
          </div>
          <input type="search" id="search" className="block w-full p-2 pl-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-gray-50 " placeholder="Search" />
        </div>
      </div>
      <Divider className='m-0 mb-3' />
      <EmojiSelect onSelect={(itm) => {
        setSelectedEmoji(itm)
      }} />
      <ColorSelect selectedEmoji={selectedEmoji} onSelect={color => {
        setSelectBackground(color)
        onSelect && onSelect(selectedEmoji, color)
      }} />
      <Divider className='m-0' />
      <div className='w-full flex items-center justify-center p-3'>
        <Button type="primary" className='w-full' onClick={() => { }}>
          OK
        </Button>
      </div>
    </div>
  }

  return <>
    <Elem />
  </>
}
export default EmojiPicker
