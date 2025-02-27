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
      className='relative flex flex-col bg-components-panel-bg border-[0.5px] border-components-panel-border rounded-xl shadow-xl z-10'
      style={{
        width: 480,
        position: 'fixed',
        top: 56 + 8,
        left: 8 + (width - 480),
        bottom: 16,
      }}
      ref={ref}
    >
      <div className='shrink-0 flex justify-between items-center pl-6 pr-5 h-14 border-b border-divider-regular'>
        <div className='text-base font-semibold text-text-primary'>PROMPT LOG</div>
        <div className='flex items-center'>
          {
            currentLogItem.log?.length === 1 && (
              <>
                <CopyFeedbackNew className='w-6 h-6' content={currentLogItem.log[0].text} />
                <div className='mx-2.5 w-[1px] h-[14px] bg-divider-regular' />
              </>
            )
          }
          <div
            onClick={onCancel}
            className='flex justify-center items-center w-6 h-6 cursor-pointer'
          >
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='grow p-2 overflow-y-auto'>
        <Card log={currentLogItem.log} />
      </div>
    </div>
  )
}

export default PromptLogModal
