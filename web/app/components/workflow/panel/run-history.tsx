import { useStore } from '../store'
import {
  CheckCircle,
  XClose,
} from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'

const RunHistory = () => {
  const mode = useStore(state => state.mode)
  const setShowRunHistory = useStore(state => state.setShowRunHistory)

  return (
    <div className='w-[200px] h-full bg-white border-[0.5px] border-gray-200 shadow-xl rounded-l-2xl z-10'>
      <div className='flex items-center justify-between px-4 pt-3 text-base font-semibold text-gray-900'>
        Run History
        <div
          className='flex items-center justify-center w-6 h-6 cursor-pointer'
          onClick={() => setShowRunHistory(false)}
        >
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      <div className='p-2'>
        {
          mode === 'workflow' && (
            <div className='flex mb-0.5 px-2 py-[7px] rounded-lg hover:bg-primary-50 cursor-pointer'>
              <CheckCircle className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#12B76A]' />
              <div>
                <div className='flex items-center text-[13px] font-medium text-primary-600 leading-[18px]'>Test Run#7</div>
                <div className='flex items-center text-xs text-gray-500 leading-[18px]'>
                  Evan · 2 min ago
                </div>
              </div>
            </div>
          )
        }
        <div className='flex px-2 py-[7px] rounded-lg hover:bg-primary-50 cursor-pointer'>
          <AlertCircle className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#F79009]' />
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

export default RunHistory
