import React from 'react'
import { useTranslation } from 'react-i18next'
import { Memory } from '@/app/components/base/icons/src/vender/line/others'
import Badge from '@/app/components/base/badge'
import Indicator from '@/app/components/header/indicator'
import type { MemoryItem } from './type'
import cn from '@/utils/classnames'

type Props = {
  memory: MemoryItem
}

const MemoryCard: React.FC<Props> = ({ memory }) => {
  const { t } = useTranslation()

  return (
    <div className={cn('mb-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-md', !memory.status && 'pb-2')}>
      <div className='flex items-end justify-between pb-1 pl-4 pr-2 pt-2'>
        <div className='flex items-center gap-1'>
          <Memory className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />
          <div className='system-sm-semibold truncate text-text-primary'>{memory.name}</div>
          <Badge text={`${t('share.chat.memory.updateVersion.update')} 2`} />
        </div>
      </div>
      <div className='system-xs-regular line-clamp-[12] px-4 pb-2 pt-1 text-text-tertiary'>{memory.content}</div>
      {memory.status === 'latest' && (
        <div className='flex items-center gap-1 rounded-b-xl border-t-[0.5px] border-divider-subtle bg-background-default-subtle px-4 py-3'>
          <div className='system-xs-regular text-text-tertiary'>{t('share.chat.memory.latestVersion')}</div>
          <Indicator color='green' />
        </div>
      )}
      {memory.status === 'needUpdate' && (
        <div className='flex items-center gap-1 rounded-b-xl border-t-[0.5px] border-divider-subtle bg-background-default-subtle px-4 py-3'>
          <div className='system-xs-regular text-text-tertiary'>{t('share.chat.memory.notLatestVersion', { num: memory.mergeCount })}</div>
          <Indicator color='orange' />
        </div>
      )}
    </div>
  )
}

export default MemoryCard
