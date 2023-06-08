import { memo } from 'react'
import { FixedSizeList as List, areEqual } from 'react-window'
import type { ListChildComponentProps } from 'react-window'
import cn from 'classnames'
import Checkbox from '../../checkbox'
import NotionIcon from '../../notion-icon'
import s from './index.module.css'
import type { DataSourceNotionPage } from '@/models/common'

const Item = memo(({ index, style, data }: ListChildComponentProps<{ list: DataSourceNotionPage[] }>) => {
  const current = data.list[index]
  let src, name

  if (current.page_icon) {
    try {
      const icon = JSON.parse(current.page_icon)

      if (icon?.type === 'emoji')
        name = icon?.emoji

      if (icon?.type === 'external')
        src = icon?.external?.url
    }
    catch (e: any) {}
  }
  return (
    <div
      className='group flex items-center px-2 rounded-md hover:bg-gray-100 cursor-pointer'
      style={{ ...style, top: style.top as number + 8, left: 8, right: 8, width: 'calc(100% - 16px)' }}
    >
      <Checkbox className='shrink-0 mr-2 group-hover:border-primary-600 group-hover:border-[2px]' />
      <div className={cn(s.arrow, s['arrow-collapse'], 'shrink-0 mr-1 w-5 h-5 hover:bg-gray-200 rounded-md')} />
      <NotionIcon
        className='shrink-0 mr-1'
        type='page'
        src={src}
        name={name}
      />
      <div
        className='text-sm font-medium text-gray-700 truncate'
        title={current.page_name}
      >
        {current.page_name}
      </div>
    </div>
  )
}, areEqual)

type PageSelectorProps = {
  list: DataSourceNotionPage[]
}

const PageSelector = ({
  list,
}: PageSelectorProps) => {
  return (
    <List
      className='py-2'
      height={296}
      itemCount={list.length}
      itemSize={28}
      width='100%'
      itemData={{ list }}
    >
      {Item}
    </List>
  )
}

export default PageSelector
