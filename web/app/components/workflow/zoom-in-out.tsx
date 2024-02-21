import type { FC } from 'react'
import {
  Fragment,
  memo,
  useState,
} from 'react'
import { useWorkflowContext } from './context'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { SearchLg } from '@/app/components/base/icons/src/vender/line/general'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

const ZOOM_IN_OUT_OPTIONS = [
  [
    {
      key: 'in',
      text: 'Zoom In',
    },
    {
      key: 'out',
      text: 'Zoom Out',
    },
  ],
  [
    {
      key: 'to50',
      text: 'Zoom to 50%',
    },
    {
      key: 'to100',
      text: 'Zoom to 100%',
    },
  ],
  [
    {
      key: 'fit',
      text: 'Zoom to Fit',
    },
  ],
]

const ZoomInOut: FC = () => {
  const { reactFlow } = useWorkflowContext()
  const [open, setOpen] = useState(false)

  const handleZoom = (type: string) => {
    if (type === 'in')
      reactFlow.zoomIn()

    if (type === 'out')
      reactFlow.zoomOut()

    if (type === 'fit')
      reactFlow.fitView()
  }

  return (
    <PortalToFollowElem
      placement='top-start'
      open={open}
      onOpenChange={setOpen}
      offset={4}
    >
      <PortalToFollowElemTrigger asChild onClick={() => setOpen(v => !v)}>
        <div className={`
          absolute left-6 bottom-6
          flex items-center px-2.5 h-9 cursor-pointer rounded-lg border-[0.5px] border-gray-100 bg-white shadow-lg
          text-[13px] text-gray-500 z-10
        `}>
          <SearchLg className='mr-1 w-4 h-4' />
          100%
          <ChevronDown className='ml-1 w-4 h-4' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='w-[168px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg'>
          {
            ZOOM_IN_OUT_OPTIONS.map((options, i) => (
              <Fragment key={i}>
                {
                  i !== 0 && (
                    <div className='h-[1px] bg-gray-100' />
                  )
                }
                <div className='p-1'>
                  {
                    options.map(option => (
                      <div
                        key={option.key}
                        className='flex items-center px-3 h-8 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700'
                        onClick={() => handleZoom(option.key)}
                      >
                        {option.text}
                      </div>
                    ))
                  }
                </div>
              </Fragment>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ZoomInOut)
