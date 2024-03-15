import type { Dispatch, FC, ReactNode, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { File02 } from '@/app/components/base/icons/src/vender/line/files'

export type LogData = {
  role: string
  text: string
}

type LogProps = {
  runID?: string
  setShowModal: Dispatch<SetStateAction<boolean>>
  children?: (v: Dispatch<SetStateAction<boolean>>) => ReactNode
}
const Log: FC<LogProps> = ({
  children,
  runID,
  setShowModal,
}) => {
  const { t } = useTranslation()

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
    </>
  )
}

export default Log
