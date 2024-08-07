import React from 'react'
import classNames from '@/utils/classnames'

export type ITagProps = {
  children: string | React.ReactNode
  color?: keyof typeof COLOR_MAP
  className?: string
  bordered?: boolean
  hideBg?: boolean
}

const COLOR_MAP = {
  green: {
    text: 'text-green-800',
    bg: 'bg-green-100',
  },
  yellow: {
    text: 'text-yellow-800',
    bg: 'bg-yellow-100',
  },
  red: {
    text: 'text-red-800',
    bg: 'bg-red-100',
  },
  gray: {
    text: 'text-gray-800',
    bg: 'bg-gray-100',
  },
}

export default function Tag({ children, color = 'green', className = '', bordered = false, hideBg = false }: ITagProps) {
  return (
    <div className={
      classNames('px-2.5 py-px text-xs leading-5 rounded-md inline-flex items-center flex-shrink-0',
        COLOR_MAP[color] ? `${COLOR_MAP[color].text} ${COLOR_MAP[color].bg}` : '',
        bordered ? 'border-[1px]' : '',
        hideBg ? 'bg-opacity-0' : '',
        className)} >
      {children}
    </div>
  )
}
