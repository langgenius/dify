import type { FC, ReactElement } from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import Tabs from './tabs'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { SearchLg } from '@/app/components/base/icons/src/vender/line/general'

type NodeSelectorProps = {
  children: ReactElement
}
const NodeSelector: FC<NodeSelectorProps> = ({
  children,
}) => {
  const [open, setOpen] = useState(false)
  const handleTrigger: any = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }, [])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='right-start'
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        {children}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50'>
        <div className='w-[256px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg'>
          <div className='px-2 pt-2'>
            <div className='flex items-center px-2 rounded-lg bg-gray-100'>
              <SearchLg className='shrink-0 ml-[1px] mr-[5px] w-3.5 h-3.5 text-gray-400' />
              <input
                className='grow px-0.5 py-[7px] text-[13px] bg-transparent appearance-none outline-none'
                placeholder='Search block'
              />
            </div>
          </div>
          <Tabs />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(NodeSelector)
