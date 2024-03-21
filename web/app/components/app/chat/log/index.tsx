import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { File02 } from '@/app/components/base/icons/src/vender/line/files'
import type { IChatItem } from '@/app/components/app/chat/type'
import { useStore as useAppStore } from '@/app/components/app/store'

type LogProps = {
  logItem: IChatItem
}
const Log: FC<LogProps> = ({
  logItem,
}) => {
  const { t } = useTranslation()
  const { setCurrentLogItem, setShowPromptLogModal, setShowMessageLogModal } = useAppStore()
  const { workflow_run_id: runID } = logItem

  return (
    <div
      className='shrink-0 p-1 flex items-center justify-center rounded-[6px] font-medium text-gray-500 hover:bg-gray-50 cursor-pointer hover:text-gray-700'
      onClick={(e) => {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        setCurrentLogItem(logItem)
        if (runID)
          setShowMessageLogModal(true)
        else
          setShowPromptLogModal(true)
      }}
    >
      <File02 className='mr-1 w-4 h-4' />
      <div className='text-xs leading-4'>{runID ? t('appLog.viewLog') : t('appLog.promptLog')}</div>
    </div>
  )
}

export default Log
