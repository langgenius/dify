import { memo } from 'react'
import { useStore } from './store'
import Button from '@/app/components/base/button'
import {
  Plus02,
  XClose,
} from '@/app/components/base/icons/src/vender/line/general'

const Features = () => {
  const showFeatures = useStore(state => state.showFeatures)
  const setShowFeatures = useStore(state => state.setShowFeatures)

  if (!showFeatures)
    return null

  return (
    <div className='absolute top-2 left-2 bottom-2 w-[600px] rounded-2xl border-[0.5px] border-gray-200 bg-white shadow-xl z-10'>
      <div className='flex items-center justify-between px-4 pt-3'>
        Features
        <div className='flex items-center'>
          <Button className='px-3 py-0 h-8 rounded-lg border border-primary-100 bg-primary-25 shadow-xs text-xs font-semibold text-primary-600'>
            <Plus02 className='mr-1 w-4 h-4' />
            Add Features
          </Button>
          <div className='mx-3 w-[1px] h-[14px] bg-gray-200'></div>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={() => setShowFeatures(false)}
          >
            <XClose className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(Features)
