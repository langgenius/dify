import {
  memo,
  useState,
} from 'react'
import { useWorkflow } from '../../../../hooks'
import ChangeBlock from './change-block'
import { DotsHorizontal } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type PanelOperatorProps = {
  nodeId: string
}
const PanelOperator = ({
  nodeId,
}: PanelOperatorProps) => {
  const { handleNodeDelete } = useWorkflow()
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 53,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div
          className={`
            flex items-center justify-center w-6 h-6 rounded-md cursor-pointer
            hover:bg-black/5
            ${open && 'bg-black/5'}
          `}
        >
          <DotsHorizontal className='w-4 h-4 text-gray-700' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[240px] border-[0.5px] border-gray-200 rounded-2xl shadow-xl bg-white'>
          <div className='p-1'>
            <ChangeBlock nodeId={nodeId} />
            <div className='flex items-center px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'>Help Link</div>
          </div>
          <div className='h-[1px] bg-gray-100'></div>
          <div className='p-1'>
            <div
              className='flex items-center px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
              onClick={() => handleNodeDelete(nodeId)}
            >
              Delete
            </div>
          </div>
          <div className='h-[1px] bg-gray-100'></div>
          <div className='p-1'>
            <div className='px-3 py-2 text-xs text-gray-500'>
              <div className='flex items-center mb-1 h-[22px] font-medium'>
                ABOUT
              </div>
              <div className='text-gray-500 leading-[18px]'>A tool for performing a Google SERP search and extracting snippets and webpages.Input should be a search query.</div>
              <div className='my-2 h-[0.5px] bg-black/5'></div>
              <div className='leading-[18px]'>
                Created By Dify
              </div>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(PanelOperator)
