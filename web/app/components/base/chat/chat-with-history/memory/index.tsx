import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import {
  useChatWithHistoryContext,
} from '../context'
import cn from '@/utils/classnames'

type Props = {
  showChatMemory?: boolean
}

const MemoryPanel: React.FC<Props> = ({ showChatMemory }) => {
  const { t } = useTranslation()
  const {
    setShowChatMemory,
  } = useChatWithHistoryContext()

  return (
    <div className={cn(
      'h-full w-[360px] shrink-0 rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-chatbot-bg transition-all ease-in-out',
      showChatMemory ? 'w-[360px]' : 'w-0',
    )}>
      <div className='flex items-center border-b-[0.5px] border-components-panel-border-subtle pl-4 pr-3.5 pt-2'>
        <div className='system-md-semibold-uppercase grow py-3 text-text-primary'>{t('share.chat.memory.title')}</div>
        <ActionButton size='l' onClick={() => setShowChatMemory(false)}>
          <RiCloseLine className='h-[18px] w-[18px]' />
        </ActionButton>
      </div>
      <div></div>
      {/* Memory content goes here */}
    </div>
  )
}

export default MemoryPanel
