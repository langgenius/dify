import type { FC } from 'react'
import { memo } from 'react'
import type { ModelAndParameter } from '../types'
import ModelParameterTrigger from './model-parameter-trigger'
import ChatItem from './chat-item'
import { useDebugWithMultipleModelContext } from './context'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import Dropdown from '@/app/components/base/dropdown'
import type { Item } from '@/app/components/base/dropdown'

type DebugItemProps = {
  modelAndParameter: ModelAndParameter
  className?: string
}
const DebugItem: FC<DebugItemProps> = ({
  modelAndParameter,
  className,
}) => {
  const { mode } = useDebugConfigurationContext()
  const {
    multipleModelConfigs,
    onMultipleModelConfigsChange,
  } = useDebugWithMultipleModelContext()

  const index = multipleModelConfigs.findIndex(v => v.id === modelAndParameter.id)

  const handleSelect = (item: Item) => {
    if (item.value === 'duplicate') {
      onMultipleModelConfigsChange(
        true,
        [
          ...multipleModelConfigs,
          {
            ...modelAndParameter,
            id: `${Date.now()}`,
          },
        ],
      )
    }
    if (item.value === 'debug-as-single-model')
      return
    if (item.value === 'remove') {
      onMultipleModelConfigsChange(
        true,
        multipleModelConfigs.filter((_, i) => i !== index),
      )
    }
  }

  return (
    <div className={`min-w-[320px] rounded-xl bg-white border-[0.5px] border-black/5 ${className}`}>
      <div className='flex items-center justify-between h-10 px-3 border-b-[0.5px] border-b-black/5'>
        <div className='flex items-center justify-center w-6 h-5 font-medium italic text-gray-500'>
          #{index + 1}
        </div>
        <ModelParameterTrigger
          modelAndParameter={modelAndParameter}
          index={index}
        />
        <Dropdown
          onSelect={handleSelect}
          items={[
            {
              value: 'duplicate',
              text: 'Duplicate',
            },
            {
              value: 'debug-as-single-model',
              text: 'Debug as Single Model',
            },
          ]}
          secondItems={
            multipleModelConfigs.length > 2
              ? [
                {
                  value: 'remove',
                  text: 'Remove',
                },
              ]
              : undefined
          }
        />
      </div>
      {
        mode === 'chat' && (
          <ChatItem />
        )
      }
    </div>
  )
}

export default memo(DebugItem)
