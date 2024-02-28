import type { FC } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import { useStore } from '../store'
import RunAndHistory from './run-and-history'
import Publish from './publish'
import { Edit03 } from '@/app/components/base/icons/src/vender/solid/general'
import { Grid01 } from '@/app/components/base/icons/src/vender/line/layout'
import Button from '@/app/components/base/button'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'

const Header: FC = () => {
  const mode = useStore(state => state.mode)
  const setShowFeatures = useStore(state => state.setShowFeatures)

  const handleShowFeatures = useCallback(() => {
    setShowFeatures(true)
  }, [setShowFeatures])

  return (
    <div
      className='absolute top-0 left-0 flex items-center justify-between px-3 w-full h-14 z-10'
      style={{
        background: 'linear-gradient(180deg, #F9FAFB 0%, rgba(249, 250, 251, 0.00) 100%)',
      }}
    >
      <div>
        <div className='text-xs font-medium text-gray-700'>Fitness and Nutrition Expert</div>
        <div className='flex items-center'>
          <div className='flex items-center text-xs text-gray-500'>
            <Edit03 className='mr-1 w-3 h-3 text-gray-400' />
            Editing
          </div>
        </div>
      </div>
      <div className='flex items-center'>
        <Button className={`
          mr-2 px-3 py-0 h-8 bg-white text-[13px] font-medium text-primary-600
          border-[0.5px] border-gray-200 shadow-xs
        `}>
          <ArrowNarrowLeft className='mr-1 w-4 h-4' />
          Go back to editor
        </Button>
        <RunAndHistory />
        <div className='mx-2 w-[1px] h-3.5 bg-gray-200'></div>
        {
          mode === 'workflow' && (
            <Button
              className={`
                mr-2 px-3 py-0 h-8 bg-white text-[13px] font-medium text-gray-700
                border-[0.5px] border-gray-200 shadow-xs
              `}
              onClick={handleShowFeatures}
            >
              <Grid01 className='mr-1 w-4 h-4 text-gray-500' />
              Features
            </Button>
          )
        }
        <Publish />
      </div>
    </div>
  )
}

export default memo(Header)
