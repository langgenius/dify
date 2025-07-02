'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

type Props = {
  list: any[]
}

const List: FC<Props> = ({
  list,
}) => {
  const { t } = useTranslation()
  return (
    <div>
      {list.length > 0 ? (
        <table className={cn('mt-2 w-full min-w-[440px] border-collapse border-0')}>
        <thead className='system-xs-medium-uppercase text-text-tertiary'>
          <tr>
            <td className='whitespace-nowrap rounded-l-lg bg-background-section-burn pl-3 pr-1'>xxx</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.endUser')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.userRate')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.time')}</td>
            <td className='whitespace-nowrap rounded-r-lg bg-background-section-burn py-1.5 pl-3'>{t('appLog.table.header.time')}</td>
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary"></tbody>
          {list.map((item, index) => (
            <tr key={index} className='hover:bg-background-section-hover'>
              <td className='w-5 whitespace-nowrap rounded-l-lg pl-3 pr-1'>
                Python bug fixer
              </td>
              <td className='whitespace-nowrap py-1.5 pl-3'>Yes</td>
              <td className='whitespace-nowrap py-1.5 pl-3'>Evan · evan@dify.ai</td>
              <td className='whitespace-nowrap py-1.5 pl-3'>2023-03-21 10:25</td>
              <td className='whitespace-nowrap rounded-r-lg py-1.5 pl-3'>2023-03-21 10:25</td>
            </tr>
          ))}
        </table>
      ) : (
        <div className='system-md-regular text-text-secondary'>No items found</div>
      )}
    </div>
  )
}
export default React.memo(List)
