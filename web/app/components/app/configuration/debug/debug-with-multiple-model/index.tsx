import type { FC } from 'react'
import { useCallback } from 'react'
import type { ModelAndParameter } from '../types'
import ChatItem from './chat-item'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import ChatInput from '@/app/components/base/chat/input-area/chat-input'
import type { VisionFile } from '@/app/components/base/chat/types'

type DebugWithMultipleModelProps = {
  multipleModelConfigs: ModelAndParameter[]
}
const DebugWithMultipleModel: FC<DebugWithMultipleModelProps> = ({
  multipleModelConfigs,
}) => {
  const { eventEmitter } = useEventEmitterContextContext()

  const handleSend = useCallback((message: string, files?: VisionFile[]) => {
    eventEmitter?.emit({
      type: 'app-chat-with-multiple-model',
      payload: {
        message,
        files,
      },
    } as any)
  }, [eventEmitter])

  const twoLine = multipleModelConfigs.length === 2
  const threeLine = multipleModelConfigs.length === 3
  const fourLine = multipleModelConfigs.length === 4

  return (
    <div className='flex flex-col h-full pt-3'>
      <div
        className={`
          grow mb-3 min-h-[400px] overflow-auto
          ${(twoLine || threeLine) && 'flex gap-2'}
          ${fourLine && 'grid grid-rows-2 gap-y-2'}
        `}
      >
        {
          (twoLine || threeLine) && multipleModelConfigs.map((modelConfig, index) => (
            <ChatItem
              key={index}
              index={index}
              modelAndParameter={modelConfig}
              className={`
                ${twoLine && 'w-1/2 h-full'}
                ${threeLine && 'w-1/3 h-full'}
              `}
            />
          ))
        }
        {
          fourLine && (
            <>
              <div className='flex gap-2'>
                {
                  multipleModelConfigs.slice(0, 2).map((modelConfig, index) => (
                    <ChatItem
                      key={index}
                      index={index}
                      modelAndParameter={modelConfig}
                      className='w-1/2 h-full'
                    />
                  ))
                }
              </div>
              <div className='flex gap-2'>
                {
                  multipleModelConfigs.slice(2, 4).map((modelConfig, index) => (
                    <ChatItem
                      key={index}
                      index={index}
                      modelAndParameter={modelConfig}
                      className='w-1/2 h-full'
                    />
                  ))
                }
              </div>
            </>
          )
        }
      </div>
      <div className='shrink-0'>
        <ChatInput onSend={handleSend} />
      </div>
    </div>
  )
}

export default DebugWithMultipleModel
