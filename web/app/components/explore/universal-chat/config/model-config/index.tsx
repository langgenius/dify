'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useBoolean, useClickAway } from 'ahooks'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import ModelIcon from '@/app/components/app/configuration/config-model/model-icon'
import { UNIVERSAL_CHAT_MODEL_LIST as MODEL_LIST } from '@/config'

export type IModelConfigProps = {
  modelId: string
  onChange?: (model: string) => void
  readonly?: boolean
}

const ModelConfig: FC<IModelConfigProps> = ({
  modelId,
  onChange,
  readonly,
}) => {
  const currModel = MODEL_LIST.find(item => item.id === modelId)
  const [isShowOption, { setFalse: hideOption, toggle: toogleOption }] = useBoolean(false)
  const triggerRef = React.useRef(null)
  useClickAway(() => {
    hideOption()
  }, triggerRef)

  return (
    <div className='flex items-center justify-between h-[52px] px-3 rounded-xl bg-gray-50'>
      <div className='text-sm font-semibold text-gray-800'>Model</div>
      <div className="relative z-10">
        <div ref={triggerRef} onClick={() => !readonly && toogleOption()} className={cn(readonly ? 'cursor-not-allowed' : 'cursor-pointer', 'flex items-center h-9 px-3 space-x-2 rounded-lg bg-gray-50 ')}>
          <ModelIcon modelId={currModel?.id as string} />
          <div className="text-sm gray-900">{currModel?.name}</div>
          {!readonly && <ChevronDownIcon className={cn(isShowOption && 'rotate-180', 'w-[14px] h-[14px] text-gray-500')} />}
        </div>
        {isShowOption && (
          <div className={cn('min-w-[159px] absolute right-0 bg-gray-50 rounded-lg shadow')}>
            {MODEL_LIST.map(item => (
              <div key={item.id} onClick={() => onChange?.(item.id)} className="flex items-center h-9 px-3 rounded-lg cursor-pointer hover:bg-gray-100">
                <ModelIcon className='shrink-0 mr-2' modelId={item?.id} />
                <div className="text-sm gray-900 whitespace-nowrap">{item.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(ModelConfig)
