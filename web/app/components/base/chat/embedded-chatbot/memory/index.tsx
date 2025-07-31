import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiDeleteBinLine,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import {
  useEmbeddedChatbotContext,
} from '../context'
import MemoryCard from './card'
import cn from '@/utils/classnames'

import { mockMemoryList } from './mock'

type Props = {
  showChatMemory?: boolean
}

const MemoryPanel: React.FC<Props> = ({ showChatMemory }) => {
  const { t } = useTranslation()
  const {
    isMobile,
    setShowChatMemory,
  } = useEmbeddedChatbotContext()

  return (
    <div className={cn(
      'flex h-full w-[360px] shrink-0 flex-col rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-chatbot-bg transition-all ease-in-out',
      showChatMemory ? 'w-[360px]' : 'w-0',
    )}>
      <div className='flex shrink-0 items-center border-b-[0.5px] border-components-panel-border-subtle pl-4 pr-3.5 pt-2'>
        <div className='system-md-semibold-uppercase grow py-3 text-text-primary'>{t('share.chat.memory.title')}</div>
        <ActionButton size='l' onClick={() => setShowChatMemory(false)}>
          <RiCloseLine className='h-[18px] w-[18px]' />
        </ActionButton>
      </div>
      <div className='h-0 grow overflow-y-auto px-3 pt-2'>
        {mockMemoryList.map(memory => (
          <MemoryCard key={memory.name} memory={memory} isMobile={isMobile} />
        ))}
        <div className='flex items-center justify-center'>
          <Button variant='ghost'>
            <RiDeleteBinLine className='mr-1 h-3.5 w-3.5' />
            {t('share.chat.memory.clearAll')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default MemoryPanel
