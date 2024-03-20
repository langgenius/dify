'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import cn from 'classnames'
import { Method } from '../types'
import Selector from '../../_base/components/selector'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
const MethodOptions = [
  { label: 'GET', value: Method.get },
  { label: 'POST', value: Method.post },
  { label: 'HEAD', value: Method.head },
  { label: 'PATCH', value: Method.patch },
  { label: 'PUT', value: Method.put },
  { label: 'DELETE', value: Method.delete },
]
type Props = {
  readonly: boolean
  method: Method
  onMethodChange: (method: Method) => void
  url: string
  onUrlChange: (url: string) => void
}

const ApiInput: FC<Props> = ({
  readonly,
  method,
  onMethodChange,
  url,
  onUrlChange,
}) => {
  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onUrlChange(e.target.value)
  }, [onUrlChange])
  return (
    <div className='flex items-center h-8 rounded-lg bg-white border border-gray-200 shadow-xs'>
      <Selector
        value={method}
        onChange={onMethodChange}
        options={MethodOptions}
        trigger={
          <div className={cn(readonly && 'cursor-pointer', 'h-8 shrink-0 flex items-center px-2.5 border-r border-black/5')} >
            <div className='w-12 pl-0.5 leading-[18px] text-xs font-medium text-gray-900 uppercase'>{method}</div>
            {!readonly && <ChevronDown className='ml-1 w-3.5 h-3.5 text-gray-700' />}
          </div>
        }
        popupClassName='top-[34px] w-[108px]'
        showChecked
        readonly={readonly}
      />
      <input
        type='text'
        readOnly={readonly}
        value={url}
        onChange={handleUrlChange}
        className='w-0 grow h-6 leading-6 px-2.5 border-0  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none'
      />
    </div >
  )
}
export default React.memo(ApiInput)
