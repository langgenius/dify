import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useClickAway } from 'ahooks'
import { RiCloseLine } from '@remixicon/react'
import Card from './card'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'
import type { IChatItem } from '@/app/components/base/chat/chat/type'

type PromptLogModalProps = {
  currentLogItem?: IChatItem
  width: number
  onCancel: () => void
}
const PromptLogModal: FC<PromptLogModalProps> = ({
  currentLogItem,
  width,
  onCancel,
}) => {
  const ref = useRef(null)
  const [mounted, setMounted] = useState(false)

  useClickAway(() => {
    if (mounted)
      onCancel()
  }, ref)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!currentLogItem || !currentLogItem.log)
    return null

  return (
    <div
      className='bg-components-panel-bg border-components-panel-border relative z-10 flex flex-col rounded-xl border-[0.5px] shadow-xl'
      style={{
        width: 480,
        position: 'fixed',
        top: 56 + 8,
        left: 8 + (width - 480),
        bottom: 16,
      }}
      ref={ref}
    >
      <div className='border-divider-regular flex h-14 shrink-0 items-center justify-between border-b pl-6 pr-5'>
        <div className='text-text-primary text-base font-semibold'>PROMPT LOG</div>
        <div className='flex items-center'>
          {
            currentLogItem.log?.length === 1 && (
              <>
                <CopyFeedbackNew className='h-6 w-6' content={currentLogItem.log[0].text} />
                <div className='bg-divider-regular mx-2.5 h-[14px] w-[1px]' />
              </>
            )
          }
          <div
            onClick={onCancel}
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
          >
            <RiCloseLine className='text-text-tertiary h-4 w-4' />
          </div>
        </div>
      </div>
      <div className='grow overflow-y-auto p-2'>
        <Card log={currentLogItem.log} />
      </div>
    </div>
  )
}

export default PromptLogModal
