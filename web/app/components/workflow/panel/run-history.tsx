import { memo } from 'react'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { useStore } from '@/app/components/workflow/store'
import { useStore as useAppStore } from '@/app/components/app/store'

const RunHistory = () => {
  const appDetail = useAppStore(state => state.appDetail)

  return (
    <div className='ml-2 w-[200px] h-full bg-white border-[0.5px] border-gray-200 shadow-xl rounded-l-2xl'>
      <div className='flex items-center justify-between px-4 pt-3 text-base font-semibold text-gray-900'>
        Run History
        <div
          className='flex items-center justify-center w-6 h-6 cursor-pointer'
          onClick={() => useStore.setState({ showRunHistory: false })}
        >
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      <div className='p-2'>
        <div
          className='flex mb-0.5 px-2 py-[7px] rounded-lg hover:bg-primary-50 cursor-pointer'
          onClick={() => useStore.setState({ runTaskId: '1' })}
        >
          {
            appDetail?.mode === 'advanced-chat' && (
              <AlertCircle className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#F79009]' />
            )
          }
          <div>
            <div className='flex items-center text-[13px] font-medium text-primary-600 leading-[18px]'>Test Run#6</div>
            <div className='flex items-center text-xs text-gray-500 leading-[18px]'>
              Evan · 30 min ago
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(RunHistory)
