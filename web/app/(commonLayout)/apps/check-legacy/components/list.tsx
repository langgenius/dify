'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import AppIcon from '@/app/components/base/app-icon'

const i18nPrefix = 'app.checkLegacy.list'
type Props = {
  list: any[]
}

const List: FC<Props> = ({
  list,
}) => {
  const { t } = useTranslation()
  return (
    <div className='h-0 grow overflow-y-auto'>
      {list.length > 0 ? (
        <table className={cn('mt-2 w-full min-w-[440px] border-collapse border-0')}>
        <thead className='system-xs-medium-uppercase text-text-tertiary'>
          <tr>
            <td className='whitespace-nowrap rounded-l-lg bg-background-section-burn pl-3 pr-1'>{t(`${i18nPrefix}.appName`)}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t(`${i18nPrefix}.published`)}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t(`${i18nPrefix}.createBy`)}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t(`${i18nPrefix}.lastRequest`)}</td>
            <td className='whitespace-nowrap rounded-r-lg bg-background-section-burn py-1.5 pl-3'>{t(`${i18nPrefix}.createAt`)}</td>
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary">
          {list.map((item, index) => (
            <tr key={index} className='cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover'>
              <td className='whitespace-nowrap rounded-l-lg py-2 pl-3 pr-1'>
                <div className='flex items-center space-x-2'>
                  <AppIcon size='tiny' />
                  <div>Python bug fixer</div>
                </div>
              </td>
              <td className='whitespace-nowrap py-1.5 pl-3'>{t('app.checkLegacy.yes')}</td>
              <td className='whitespace-nowrap py-1.5 pl-3'>Evan · evan@dify.ai</td>
              <td className='whitespace-nowrap py-1.5 pl-3'>2023-03-21 10:25</td>
              <td className='whitespace-nowrap rounded-r-lg py-1.5 pl-3'>2023-03-21 10:25</td>
            </tr>
          ))}
          </tbody>
        </table>
      ) : (
        <div className='system-md-regular flex items-center justify-center text-text-secondary'>{t(`${i18nPrefix}.noData`)}</div>
      )}
    </div>
  )
}
export default React.memo(List)
