import {
  memo,
  useState,
} from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Checklist } from '@/app/components/base/icons/src/vender/line/general'

const WorkflowChecklist = () => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 12,
        crossAxis: -4,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className='flex items-center justify-center p-0.5 w-8 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'>
          <div
            className={`
              group flex items-center justify-center w-full h-full rounded-md cursor-pointer 
              hover:bg-primary-50
              ${open && 'bg-primary-50'}
            `}
          >
            <Checklist
              className={`
                w-4 h-4 group-hover:text-primary-600
                ${open ? 'text-primary-600' : 'text-gray-500'}`
              }
            />
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent></PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(WorkflowChecklist)
