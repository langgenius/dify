import { RiCheckLine } from '@remixicon/react'
import cn from '@/utils/classnames'

const Icon = ({
  className,
  src,
  installed = false,
}: {
  className?: string
  src: string
  installed?: boolean
}) => {
  return (
    <div
      className={cn('shrink-0 relative w-10 h-10 rounded-md bg-center bg-no-repeat bg-contain', className)}
      style={{
        backgroundImage: `url(${src})`,
      }}
    >
      {installed
        && <div className='p-0.5 absolute bottom-[-4px] right-[-4px] w-3 h-3 rounded-full bg-white '>
          <div className='h-full rounded-full bg-state-success-solid'>
            <RiCheckLine className='w-full h-full text-text-primary-on-surface' />
          </div>
        </div>
      }
    </div>
  )
}

export default Icon
