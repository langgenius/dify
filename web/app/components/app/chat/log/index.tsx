import type { Dispatch, FC, ReactNode, RefObject, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import { File02 } from '@/app/components/base/icons/src/vender/line/files'
import PromptLogModal from '@/app/components/base/prompt-log-modal'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export type LogData = {
  role: string
  text: string
}

type LogProps = {
  containerRef: RefObject<HTMLElement>
  log: {
    items: LogData[]
    isTextGeneration: boolean
  }
  children?: (v: Dispatch<SetStateAction<boolean>>) => ReactNode
}
const Log: FC<LogProps> = ({
  containerRef,
  children,
  log,
}) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [showModal, setShowModal] = useState(false)
  const [width, setWidth] = useState(0)

  const adjustModalWidth = () => {
    if (containerRef.current)
      setWidth(document.body.clientWidth - (containerRef.current?.clientWidth + 56 + 16))
  }

  eventEmitter?.useSubscription((v) => {
    if (v === 'prompt-log-modal-close')
      setShowModal(false)
  })

  const handleOpenPromptLogModal = () => {
    eventEmitter?.emit('prompt-log-modal-close')
    setShowModal(true)
  }

  useEffect(() => {
    adjustModalWidth()
  }, [])

  return (
    <>
      {
        children
          ? children(setShowModal)
          : (
            <div className={`
              hidden absolute -left-[14px] -top-[14px] group-hover:block w-7 h-7
              p-0.5 rounded-lg border-[0.5px] border-gray-100 bg-white shadow-md cursor-pointer
            `}>
              <div
                className='flex items-center justify-center rounded-md w-full h-full hover:bg-gray-100'
                onClick={handleOpenPromptLogModal}
              >
                <File02 className='w-4 h-4 text-gray-500' />
              </div>
            </div>
          )
      }
      {
        showModal && (
          <PromptLogModal
            width={width}
            log={log}
            onCancel={() => setShowModal(false)}
          />
        )
      }
    </>
  )
}

export default Log
