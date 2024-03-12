import { memo } from 'react'
import Run from '../run'
import { useStore } from '../store'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

const Record = () => {
  const { currentSequenceNumber, setCurrentSequenceNumber, workflowRunId, setWorkflowRunId } = useStore()
  return (
    <div className='flex flex-col w-[400px] h-full rounded-2xl border-[0.5px] border-gray-200 shadow-xl bg-white'>
      <div className='flex items-center justify-between p-4 pb-1 text-base font-semibold text-gray-900'>
        {`Test Run#${currentSequenceNumber}`}
        <div
          className='flex items-center justify-center w-6 h-6 cursor-pointer'
          onClick={() => {
            setWorkflowRunId('')
            setCurrentSequenceNumber(0)
          }}
        >
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      <Run runID={workflowRunId} />
    </div>
  )
}

export default memo(Record)
