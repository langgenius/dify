import React from 'react'
import Divider from '../../divider'
import Button from '../../button'
import cn from '@/utils/classnames'
import { RiBookOpenLine, RiEqualizer2Line } from '@remixicon/react'

type HeaderProps = {
  isInPipeline?: boolean
  handleConfigureNotion: () => void
}

const Header = ({
  isInPipeline = false,
  handleConfigureNotion,
}: HeaderProps) => {
  return (
    <div className='flex items-center gap-x-2'>
      <div className='flex grow items-center gap-x-1'>
        <div className={cn(
          'text-text-secondary',
          isInPipeline ? 'system-sm-semibold' : 'system-md-semibold',
        )}>
          Choose notion pages
        </div>
        <Divider type='vertical' className='mx-1 h-3.5' />
        <Button
          variant='secondary'
          size='small'
          className={cn(isInPipeline ? 'px-1' : 'px-1.5')}
        >
          <RiEqualizer2Line
            className='h-4 w-4'
            onClick={handleConfigureNotion}
          />
          {!isInPipeline && (
            <span className='system-xs-medium'>
              Configure Notion
            </span>
          )}
        </Button>
      </div>
      <a
        className='system-xs-medium flex items-center gap-x-1 text-text-accent'
        href='https://www.notion.so/docs'
        target='_blank'
        rel='noopener noreferrer'
      >
        <RiBookOpenLine className='size-3.5' />
        <span>Notion docs</span>
      </a>
    </div>
  )
}

export default React.memo(Header)
