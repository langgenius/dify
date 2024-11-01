import {
  useState,
} from 'react'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInstallLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'
// import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { useMemo } from 'react'
import cn from '@/utils/classnames'

const InstallInfo = () => {
  const [open, setOpen] = useState(false)
  const status = 'error'
  const statusError = useMemo(() => status === 'error', [status])

  return (
    <div className='flex items-center'>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-start'
        offset={{
          mainAxis: 4,
          crossAxis: 79,
        }}
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
          <Tooltip popupContent='Installing 1/3 plugins...'>
            <div
              className={cn(
                'relative flex items-center justify-center w-8 h-8 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-components-button-secondary-bg-hover',
                statusError && 'border-components-button-destructive-secondary-border-hover bg-state-destructive-hover hover:bg-state-destructive-hover-alt',
              )}
            >
              <RiInstallLine
                className={cn(
                  'w-4 h-4 text-components-button-secondary-text',
                  statusError && 'text-components-button-destructive-secondary-text',
                )}
              />
              <div className='absolute -right-1 -top-1'>
                {/* <ProgressCircle
                  percentage={33}
                  circleFillColor='fill-components-progress-brand-bg'
                  sectorFillColor='fill-components-progress-error-bg'
                  circleStrokeColor='stroke-components-progress-error-bg'
                /> */}
                <RiCheckboxCircleFill className='w-3.5 h-3.5 text-text-success' />
              </div>
            </div>
          </Tooltip>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent>
          <div className='p-1 pb-2 w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
            <div className='flex items-center px-2 pt-1 h-7 system-sm-semibold-uppercase'>3 plugins failed to install</div>
            <div className='flex items-center p-1 pl-2 h-8 rounded-lg hover:bg-state-base-hover'>
              <div className='relative flex items-center justify-center mr-2 w-6 h-6 rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'>
                <RiErrorWarningFill className='absolute -right-0.5 -bottom-0.5 w-3 h-3 text-text-destructive' />
              </div>
              <div className='grow system-md-regular text-text-secondary truncate'>
                DuckDuckGo Search
              </div>
              <Button
                size='small'
                variant='ghost-accent'
              >
                Clear
              </Button>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default InstallInfo
