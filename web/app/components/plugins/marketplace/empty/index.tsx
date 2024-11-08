import { Group } from '@/app/components/base/icons/src/vender/other'
import Line from './line'

const Empty = () => {
  return (
    <div
      className='grow relative h-0 grid grid-cols-4 grid-rows-4 gap-3 p-2 overflow-hidden'
    >
      {
        Array.from({ length: 16 }).map((_, index) => (
          <div
            key={index}
            className='h-[144px] rounded-xl bg-background-section-burn'
          >
          </div>
        ))
      }
      <div
        className='absolute inset-0 z-[1]'
        style={{
          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.01), #FCFCFD)',
        }}
      ></div>
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[2] flex flex-col items-center'>
        <div className='relative flex items-center justify-center mb-3 w-14 h-14 rounded-xl border border-divider-subtle bg-components-card-bg shadow-lg'>
          <Group className='w-5 h-5' />
          <Line className='absolute -right-[1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute -left-[1px] top-1/2 -translate-y-1/2' />
          <Line className='absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90' />
          <Line className='absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90' />
        </div>
        <div className='text-center system-md-regular text-text-tertiary'>
          No plugin found
        </div>
      </div>
    </div>
  )
}

export default Empty
