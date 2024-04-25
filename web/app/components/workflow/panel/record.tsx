import { memo } from 'react'
import Run from '../run'
import { useStore } from '../store'

const Record = () => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)

  return (
    <div className='flex flex-col w-[400px] h-full rounded-l-2xl border-[0.5px] border-gray-200 shadow-xl bg-white'>
      <div className='flex items-center justify-between p-4 pb-1 text-base font-semibold text-gray-900'>
        {`Test Run#${historyWorkflowData?.sequence_number}`}
      </div>
      <Run runID={historyWorkflowData?.id || ''} />
    </div>
  )
}

export default memo(Record)
