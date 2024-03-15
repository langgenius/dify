import type { Dispatch, FC, ReactNode, RefObject, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { File02 } from '@/app/components/base/icons/src/vender/line/files'
import PromptLogModal from '@/app/components/base/prompt-log-modal'

export type LogData = {
  role: string
  text: string
}

type LogProps = {
  containerRef: RefObject<HTMLElement>
  log: LogData[]
  runID?: string
  children?: (v: Dispatch<SetStateAction<boolean>>) => ReactNode
}
const Log: FC<LogProps> = ({
  containerRef,
  children,
  log,
  runID,
}) => {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const [width, setWidth] = useState(0)

  const adjustModalWidth = () => {
    if (containerRef.current)
      setWidth(document.body.clientWidth - (containerRef.current?.clientWidth + 56 + 16))
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
            <div
              className='p-1 flex items-center justify-center rounded-[6px] hover:bg-gray-50 cursor-pointer'
              onClick={(e) => {
                e.stopPropagation()
                setShowModal(true)
              }}
            >
              <File02 className='mr-1 w-4 h-4 text-gray-500' />
              <div className='text-xs leading-4 text-gray-500'>{runID ? t('appLog.viewLog') : t('appLog.promptLog')}</div>
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
