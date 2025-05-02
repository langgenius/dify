import { pinyin } from 'pinyin-pro'
import type { FC, RefObject } from 'react'
import type { ToolWithProvider } from '../types'
import { CollectionType } from '../../tools/types'
import classNames from '@/utils/classnames'

export const CUSTOM_GROUP_NAME = '@@@custom@@@'
export const WORKFLOW_GROUP_NAME = '@@@workflow@@@'
export const AGENT_GROUP_NAME = '@@@agent@@@'
/*
{
  A: {
    'google': [ // plugin organize name
      ...tools
    ],
    'custom': [ // custom tools
      ...tools
    ],
    'workflow': [ // workflow as tools
      ...tools
    ]
  }
}
*/
export const groupItems = (items: ToolWithProvider[], getFirstChar: (item: ToolWithProvider) => string) => {
  const groups = items.reduce((acc: Record<string, Record<string, ToolWithProvider[]>>, item) => {
    const firstChar = getFirstChar(item)
    if (!firstChar || firstChar.length === 0)
      return acc

    let letter

    // transform Chinese to pinyin
    if (/[\u4E00-\u9FA5]/.test(firstChar))
      letter = pinyin(firstChar, { pattern: 'first', toneType: 'none' })[0].toUpperCase()
    else
      letter = firstChar.toUpperCase()

    if (!/[A-Z]/.test(letter))
      letter = '#'

    if (!acc[letter])
      acc[letter] = {}

    let groupName: string = ''
    if (item.type === CollectionType.builtIn)
      groupName = item.author
    else if (item.type === CollectionType.custom)
      groupName = CUSTOM_GROUP_NAME
    else if (item.type === CollectionType.workflow)
      groupName = WORKFLOW_GROUP_NAME
    else
      groupName = AGENT_GROUP_NAME

    if (!acc[letter][groupName])
      acc[letter][groupName] = []

    acc[letter][groupName].push(item)

    return acc
  }, {})

  const letters = Object.keys(groups).sort()
  // move '#' to the end
  const hashIndex = letters.indexOf('#')
  if (hashIndex !== -1) {
    letters.splice(hashIndex, 1)
    letters.push('#')
  }
  return { letters, groups }
}

type IndexBarProps = {
  letters: string[]
  itemRefs: RefObject<{ [key: string]: HTMLElement | null }>
  className?: string
}

const IndexBar: FC<IndexBarProps> = ({ letters, itemRefs, className }) => {
  const handleIndexClick = (letter: string) => {
    const element = itemRefs.current?.[letter]
    if (element)
      element.scrollIntoView({ behavior: 'smooth' })
  }
  return (
    <div className={classNames('index-bar absolute right-0 top-36 flex flex-col items-center w-6 justify-center text-xs font-medium text-text-quaternary', className)}>
      <div className='absolute left-0 top-0 h-full w-px bg-[linear-gradient(270deg,rgba(255,255,255,0)_0%,rgba(16,24,40,0.08)_30%,rgba(16,24,40,0.08)_50%,rgba(16,24,40,0.08)_70.5%,rgba(255,255,255,0)_100%)]'></div>
      {letters.map(letter => (
        <div className="hover:text-text-secondary cursor-pointer" key={letter} onClick={() => handleIndexClick(letter)}>
          {letter}
        </div>
      ))}
    </div>
  )
}

export default IndexBar
