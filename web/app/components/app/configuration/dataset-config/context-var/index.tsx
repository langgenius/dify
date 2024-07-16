'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiQuestionLine,
} from '@remixicon/react'
import type { Props } from './var-picker'
import VarPicker from './var-picker'
import cn from '@/utils/classnames'
import { BracketsX } from '@/app/components/base/icons/src/vender/line/development'
import Tooltip from '@/app/components/base/tooltip'

const ContextVar: FC<Props> = (props) => {
  const { t } = useTranslation()
  const { value, options } = props
  const currItem = options.find(item => item.value === value)
  const notSetVar = !currItem
  return (
    <div className={cn(notSetVar ? 'rounded-bl-xl rounded-br-xl bg-[#FEF0C7] border-[#FEF0C7]' : 'border-gray-200', 'flex justify-between items-center h-12 px-3 border-t ')}>
      <div className='flex items-center space-x-1 shrink-0'>
        <div className='p-1'>
          <BracketsX className='w-4 h-4 text-primary-500' />
        </div>
        <div className='mr-1 text-sm font-medium text-gray-800'>{t('appDebug.feature.dataSet.queryVariable.title')}</div>
        <Tooltip
          htmlContent={<div className='w-[180px]'>
            {t('appDebug.feature.dataSet.queryVariable.tip')}
          </div>}
          selector='context-var-tooltip'
        >
          <RiQuestionLine className='w-3.5 h-3.5 text-gray-400' />
        </Tooltip>
      </div>

      <VarPicker {...props} />
    </div>
  )
}

export default React.memo(ContextVar)
