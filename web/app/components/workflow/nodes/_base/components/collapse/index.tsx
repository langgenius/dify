import { useState } from 'react'
import { RiArrowDropRightLine } from '@remixicon/react'
import cn from '@/utils/classnames'

export { default as FieldCollapse } from './field-collapse'

type CollapseProps = {
  disabled?: boolean
  trigger: React.JSX.Element
  children: React.JSX.Element
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
}
const Collapse = ({
  disabled,
  trigger,
  children,
  collapsed,
  onCollapse,
}: CollapseProps) => {
  const [collapsedLocal, setCollapsedLocal] = useState(true)
  const collapsedMerged = collapsed !== undefined ? collapsed : collapsedLocal

  return (
    <>
      <div
        className='flex items-center'
        onClick={() => {
          if (!disabled) {
            setCollapsedLocal(!collapsedMerged)
            onCollapse?.(!collapsedMerged)
          }
        }}
      >
        <div className='h-4 w-4 shrink-0'>
          {
            !disabled && (
              <RiArrowDropRightLine
                className={cn(
                  'text-text-tertiary h-4 w-4',
                  !collapsedMerged && 'rotate-90',
                )}
              />
            )
          }
        </div>
        {trigger}
      </div>
      {
        !collapsedMerged && children
      }
    </>
  )
}

export default Collapse
