'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Item from './item'
import type { Plugin } from '@/app/components/plugins/types.ts'

type Props = {
  list: Plugin[]
  // onInstall: () =>
}

const List: FC<Props> = ({
  list,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='pt-3 px-4 py-1 text-text-primary system-sm-medium'>
        {t('plugin.fromMarketplace')}
      </div>
      <div className='p-1'>
        {list.map((item, index) => (
          <Item
            key={index}
            payload={item}
            onAction={() => { }}
          />
        ))}
      </div>
    </div>
  )
}
export default React.memo(List)
