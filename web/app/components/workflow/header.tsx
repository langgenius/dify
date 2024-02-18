import { Edit03 } from '@/app/components/base/icons/src/vender/solid/general'
import Button from '@/app/components/base/button'

const Header = () => {
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
      <div>
        <Button
          type='primary'
          className='px-3 py-0 h-8 text-[13px] font-medium'
        >
          publish
        </Button>
      </div>
    </div>
  )
}

export default Header
