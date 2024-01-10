'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { Collection, Tool } from '../types'
import { LOC } from '../types'
import Loading from '../../base/loading'
import { ArrowNarrowRight } from '../../base/icons/src/vender/line/arrows'
import Header from './header'

type Props = {
  collection: Collection | null
  list: Tool[]
  loc: LOC
}

const ToolList: FC<Props> = ({
  collection,
  list,
  loc,
}) => {
  const { t } = useTranslation()

  if (!collection)
    return <Loading type='app' />

  return (
    <>
      <Header
        collection={collection}
        loc={loc}
      />
      <div className={cn(loc === LOC.tools ? 'px-6 pt-4' : 'px-4 pt-3')}>
        <div className='flex items-center h-[4.5] space-x-2  text-xs font-medium text-gray-500'>
          <div className=''>{t('tools.includeToolNum', {
            num: list.length,
          })}</div>
          {!collection.is_team_authorization && (
            <>
              <div>·</div>
              <div className='flex items-center text-[#155EEF] cursor-pointer'>
                <div>{t('tools.auth.setup')}</div>
                <ArrowNarrowRight className='ml-0.5 w-3 h-3' />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
export default React.memo(ToolList)
