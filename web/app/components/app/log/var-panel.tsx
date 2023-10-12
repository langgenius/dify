'use client'
import { useBoolean } from 'ahooks'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'

type Props = {
  varList: { label: string; value: string }[]
}

const VarPanel: FC<Props> = ({
  varList,
}) => {
  const { t } = useTranslation()
  const [isCollapse, { toggle: toggleCollapse }] = useBoolean(false)
  return (
    <div className='rounded-xl border border-color-indigo-100 bg-indigo-25'>
      <div
        className='flex items-center h-6 pl-2 py-6 space-x-1 cursor-pointer'
        onClick={toggleCollapse}
      >
        {
          isCollapse
            ? <ChevronRight className='w-3 h-3 text-gray-300' />
            : <ChevronDown className='w-3 h-3 text-gray-300' />
        }
        <div className='text-sm font-semibold text-indigo-800 uppercase'>{t('appLog.detail.variables')}</div>
      </div>
      {!isCollapse && (
        <div className='px-6 pb-3'>
          {varList.map(({ label, value }, index) => (
            <div key={index} className='flex py-1 leading-[18px] text-[13px]'>
              <div className='shrink-0 w-[128px] flex text-primary-600'>
                <span className='shrink-0 opacity-60'>{'{{'}</span>
                <span className='truncate'>{label}</span>
                <span className='shrink-0 opacity-60'>{'}}'}</span>
              </div>
              <div className='pl-2.5 break-all'>{value}</div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
export default React.memo(VarPanel)
