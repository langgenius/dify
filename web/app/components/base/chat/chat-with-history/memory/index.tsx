import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiDeleteBinLine,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import MemoryCard from './card'
import cn from '@/utils/classnames'

import type { Memory } from '@/app/components/base/chat/types'

type Props = {
  isMobile?: boolean
  showChatMemory?: boolean
  setShowChatMemory: (show: boolean) => void
  memoryList: Memory[]
  clearAllMemory: () => void
  updateMemory: (memory: Memory, content: string) => void
  resetDefault: (memory: Memory) => void
  clearAllUpdateVersion: (memory: Memory) => void
  switchMemoryVersion: (memory: Memory, version: string) => void
}

const MemoryPanel: React.FC<Props> = ({
  isMobile,
  showChatMemory,
  setShowChatMemory,
  memoryList,
  clearAllMemory,
  updateMemory,
  resetDefault,
  clearAllUpdateVersion,
  switchMemoryVersion,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(
      'flex h-full w-[360px] shrink-0 flex-col rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-chatbot-bg transition-all ease-in-out',
      showChatMemory ? 'w-[360px]' : 'w-0 opacity-0',
    )}>
      <div className='flex shrink-0 items-center border-b-[0.5px] border-components-panel-border-subtle pl-4 pr-3.5 pt-2'>
        <div className='system-md-semibold-uppercase grow py-3 text-text-primary'>{t('share.chat.memory.title')}</div>
        <ActionButton size='l' onClick={() => setShowChatMemory(false)}>
          <RiCloseLine className='h-[18px] w-[18px]' />
        </ActionButton>
      </div>
      <div className='h-0 grow overflow-y-auto px-3 pt-2'>
        {memoryList.map(memory => (
          <MemoryCard
            key={memory.spec.id}
            isMobile={isMobile}
            memory={memory}
            updateMemory={updateMemory}
            resetDefault={resetDefault}
            clearAllUpdateVersion={clearAllUpdateVersion}
            switchMemoryVersion={switchMemoryVersion}
          />
        ))}
        {memoryList.length > 0 && (
          <div className='flex items-center justify-center'>
            <Button variant='ghost' onClick={clearAllMemory}>
              <RiDeleteBinLine className='mr-1 h-3.5 w-3.5' />
              {t('share.chat.memory.clearAll')}
            </Button>
          </div>
        )}
        {memoryList.length === 0 && (
          <div className='system-xs-regular flex items-center justify-center py-2 text-text-tertiary'>
            {t('share.chat.memory.empty')}
          </div>
        )}
      </div>
    </div>
  )
}

export default MemoryPanel
