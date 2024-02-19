import type { FC, ReactElement } from 'react'
import {
  memo,
  useState,
} from 'react'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react'
import Tabs from './tabs'
import { SearchLg } from '@/app/components/base/icons/src/vender/line/general'

type NodeSelectorProps = {
  placement?: Placement
  offset?: OffsetOptions
  className?: string
  children: (props: any) => ReactElement
}
const NodeSelector: FC<NodeSelectorProps> = ({
  placement = 'top',
  offset: offsetValue = 0,
  className,
  children,
}) => {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    placement,
    strategy: 'fixed',
    open,
    onOpenChange: setOpen,
    middleware: [
      flip(),
      shift(),
      offset(offsetValue),
    ],
  })
  const click = useClick(context)
  const dismiss = useDismiss(context, {
    bubbles: false,
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ])

  return (
    <>
      {children({ ...getReferenceProps(), ref: refs.setReference, open })}
      {
        open && (
          <FloatingPortal>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className='z-[1000]'
            >
              <div className={`w-[256px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg ${className}`}>
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
            </div>
          </FloatingPortal>
        )
      }
    </>
  )
}

export default memo(NodeSelector)
