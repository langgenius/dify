import { memo } from 'react'
import {
  RiAddLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'

const Configure = () => {
  return (
    <>
      <PortalToFollowElem
        placement='bottom-end'
        offset={{
          mainAxis: 4,
          crossAxis: -4,
        }}
      >
        <PortalToFollowElemTrigger>
          <Button
            variant='secondary-accent'
          >
            <RiAddLine className='h-4 w-4' />
            Configure
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[61]'>
          <div className='w-[240px] space-y-1.5 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg'>
            <Button
              variant='primary'
              className='w-full px-0'
            >
              <div className='grow'>
                use oauth
              </div>
              <div className='h-4 w-[1px] bg-text-primary-on-surface opacity-[0.15]'></div>
              <div className='flex h-8 w-8 shrink-0 items-center justify-center'>
                <RiEqualizer2Line className='h-4 w-4' />
              </div>
            </Button>
            <div className='system-2xs-medium-uppercase flex h-4 items-center p-2 text-text-quaternary'>
              <div className='mr-2 h-[1px] grow bg-gradient-to-l from-[rgba(16,24,40,0.08)]' />
              OR
              <div className='ml-2 h-[1px] grow bg-gradient-to-r from-[rgba(16,24,40,0.08)]' />
            </div>
            <Button
              className='w-full'
              variant='secondary-accent'
            >
              Use API Key
            </Button>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}

export default memo(Configure)
