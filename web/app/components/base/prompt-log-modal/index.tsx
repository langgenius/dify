import type { FC } from 'react'
import Card from './card'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

type PromptLogModalProps = {
  log: {
    items: { role: string; text: string }[]
    isTextGeneration: boolean
  }
  width: number
  onCancel: () => void
}
const PromptLogModal: FC<PromptLogModalProps> = ({
  log,
  width,
  onCancel,
}) => {
  return (
    <div
      className='fixed top-16 left-2 bottom-2 bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl z-10'
      style={{ width }}>
      <div className='flex justify-between items-center pl-6 pr-5 h-14 border-b border-b-gray-100'>
        <div className='text-base font-semibold text-gray-900'>PROMPT LOG</div>
        <div className='flex items-center'>
          {
            log.isTextGeneration && (
              <>
                <CopyFeedbackNew className='w-6 h-6' content={log.items?.[0].text} />
                <div className='mx-2.5 w-[1px] h-[14px] bg-gray-200' />
              </>
            )
          }
          <div
            onClick={onCancel}
            className='flex justify-center items-center w-6 h-6 cursor-pointer'
          >
            <XClose className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
      <div className='p-2'>
        <Card log={log} />
      </div>
    </div>
  )
}

export default PromptLogModal
