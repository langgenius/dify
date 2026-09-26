import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiFileList3Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

type LogProps = {
  logItem: IChatItem
  onOpenLog: (item: IChatItem) => void
}
const Log: FC<LogProps> = ({ logItem, onOpenLog }) => {
  const { t } = useTranslation(['common'])

  return (
    <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
      <IconButton
        aria-label={t(($) => $['operation.log'], { ns: 'common' })}
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onOpenLog(logItem)
        }}
      >
        <RiFileList3Line aria-hidden="true" className="size-4" />
      </IconButton>
    </div>
  )
}

export default Log
