'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import VarReferencePicker from '../../_base/components/variable/var-reference-picker'
import type { Condition } from '@/app/components/workflow/nodes/if-else/types'
import { LogicalOperator } from '@/app/components/workflow/nodes/if-else/types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import { RefreshCw05 } from '@/app/components/base/icons/src/vender/line/arrows'
const i18nPrefix = 'workflow.nodes.ifElse'

const Line = (
  <svg xmlns="http://www.w3.org/2000/svg" width="163" height="2" viewBox="0 0 163 2" fill="none">
    <path d="M0 1H162.5" stroke="url(#paint0_linear_641_36452)" />
    <defs>
      <linearGradient id="paint0_linear_641_36452" x1="162.5" y1="9.99584" x2="6.6086e-06" y2="9.94317" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F3F4F6" />
        <stop offset="1" stopColor="#F3F4F6" stopOpacity="0" />
      </linearGradient>
    </defs>
  </svg>
)

type ItemProps = {
  readonly: boolean
  payload: Condition
  onChange: (newItem: Condition) => void
  canRemove: boolean
  onRemove?: () => void
  isShowLogicalOperator?: boolean
  logicalOperator: LogicalOperator
  onLogicalOperatorToggle: () => void
}

const Item: FC<ItemProps> = ({
  readonly,
  payload,
  onChange,
  canRemove,
  onRemove = () => { },
  isShowLogicalOperator,
  logicalOperator,
  onLogicalOperatorToggle,
}) => {
  const { t } = useTranslation()

  const handleVarReferenceChange = useCallback((value: ValueSelector) => {
    onChange({
      ...payload,
      variable_selector: value,
    })
  }, [onChange, payload])

  const handleValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...payload,
      value: e.target.value,
    })
  }, [onChange, payload])

  return (
    <div className='space-y-2'>
      {isShowLogicalOperator && (
        <div className='flex items-center select-none'>
          <div className='flex items-center '>
            {Line}
            <div
              className='shrink-0 mx-1 flex items-center h-[22px] pl-2 pr-1.5 border border-gray-200 rounded-lg bg-white shadow-xs space-x-0.5 text-primary-600 cursor-pointer'
              onClick={onLogicalOperatorToggle}
            >
              <div className='text-xs font-semibold uppercase'>{t(`${i18nPrefix}.${logicalOperator === LogicalOperator.and ? 'and' : 'or'}`)}</div>
              <RefreshCw05 className='w-3 h-3' />
            </div>
            <div className=' rotate-180'>
              {Line}
            </div>
          </div>
        </div>
      )
      }

      <div className='flex items-center space-x-1'>
        <VarReferencePicker
          readonly={readonly}
          isShowNodeName
          className='grow'
          value={payload.variable_selector}
          onChange={handleVarReferenceChange}
        />

        <input
          readOnly={readonly}
          value={payload.value}
          onChange={handleValueChange}
          placeholder={t(`${i18nPrefix}.enterValue`)!}
          className='w-[144px] h-8 leading-8 px-2.5  rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
          type='text'
        />

        <div
          className={cn(canRemove ? 'text-gray-500 bg-gray-100 hover:bg-gray-200  cursor-pointer' : 'bg-gray-25 text-gray-300', 'p-2 rounded-lg ')}
          onClick={canRemove ? onRemove : () => { }}
        >
          <Trash03 className='w-4 h-4 ' />
        </div>
      </div>
    </div >

  )
}
export default React.memo(Item)
