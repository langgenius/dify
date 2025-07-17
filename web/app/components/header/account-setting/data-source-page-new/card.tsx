import { memo } from 'react'
import Item from './item'
import Configure from './configure'
import type { DataSourceAuth } from './types'
import { useRenderI18nObject } from '@/hooks/use-i18n'

type CardProps = {
  item: DataSourceAuth
}
const Card = ({
  item,
}: CardProps) => {
  const renderI18nObject = useRenderI18nObject()
  const {
    icon,
    label,
    author,
    provider,
    credentials_list,
  } = item

  return (
    <div className='rounded-xl bg-background-section-burn'>
      <div className='flex items-center p-3 pb-2'>
        <img
          src={icon}
          className='mr-3 flex h-10 w-10 shrink-0 items-center justify-center'
        />
        <div className='grow'>
          <div className='system-md-semibold text-text-primary'>
            {renderI18nObject(label)}
          </div>
          <div className='system-xs-regular flex h-4 items-center text-text-tertiary'>
            {author}
            <div className='text-text-quaternary'>/</div>
            {provider}
          </div>
        </div>
        <Configure />
      </div>
      <div className='system-xs-medium flex h-4 items-center pl-3 text-text-tertiary'>
        Connected workspace
        <div className='ml-3 h-[1px] grow bg-divider-subtle'></div>
      </div>
      {
        !!credentials_list.length && (
          <div className='space-y-1 p-3 pt-2'>
            <Item />
            <Item />
            <Item />
          </div>
        )
      }
      {
        !credentials_list.length && (
          <div className='p-3 pt-1'>
            <div className='system-xs-regular flex h-10 items-center justify-center rounded-[10px] bg-background-section text-text-tertiary'>
              Please configure authentication
            </div>
          </div>
        )
      }
    </div>
  )
}

export default memo(Card)
