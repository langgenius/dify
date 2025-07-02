import React from 'react'
import Divider from '@/app/components/base/divider'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import { RiBookOpenLine, RiEqualizer2Line } from '@remixicon/react'

type HeaderProps = {
  isInPipeline?: boolean
  onClickConfiguration?: () => void
  title: string
  buttonText?: string
  docTitle: string
  docLink: string
}

const Header = ({
  isInPipeline = false,
  onClickConfiguration,
  title,
  buttonText,
  docTitle,
  docLink,
}: HeaderProps) => {
  return (
    <div className='flex items-center gap-x-2'>
      <div className='flex shrink-0 grow items-center gap-x-1'>
        <div className={cn(
          'text-text-secondary',
          isInPipeline ? 'system-sm-semibold' : 'system-md-semibold',
        )}>
          {title}
        </div>
        {!isInPipeline && (
          <>
            <Divider type='vertical' className='mx-1 h-3.5' />
            <Button
              variant='secondary'
              size='small'
              className='px-1.5'
            >
              <RiEqualizer2Line
                className='h-4 w-4'
                onClick={onClickConfiguration}
              />
              <span className='system-xs-medium'>
                {buttonText}
              </span>
            </Button>
          </>
        )}
      </div>
      <a
        className='system-xs-medium flex items-center gap-x-1 overflow-hidden text-text-accent'
        href={docLink}
        target='_blank'
        rel='noopener noreferrer'
      >
        <RiBookOpenLine className='size-3.5 shrink-0' />
        <span className='grow truncate' title={docTitle}>{docTitle}</span>
      </a>
    </div>
  )
}

export default React.memo(Header)
