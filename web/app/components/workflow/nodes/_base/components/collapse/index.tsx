import type { ReactNode } from 'react'
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
  operations?: ReactNode

}
const Collapse = ({
  disabled,
  trigger,
  children,
  collapsed,
  onCollapse,
  operations,
}: CollapseProps) => {
  const [collapsedLocal, setCollapsedLocal] = useState(true)
  const collapsedMerged = collapsed !== undefined ? collapsed : collapsedLocal

  return (
    <>
      <div className='flex justify-between items-center'>
        <div
          className='flex items-center'
          onClick={() => {
            if (!disabled) {
              setCollapsedLocal(!collapsedMerged)
              onCollapse?.(!collapsedMerged)
            }
          }}
        >
          <div className='shrink-0 w-4 h-4'>
            {
              !disabled && (
                <RiArrowDropRightLine
                  className={cn(
                    'w-4 h-4 text-text-tertiary',
                    !collapsedMerged && 'transform rotate-90',
                  )}
                />
              )
            }
          </div>
          {trigger}
        </div>
        {operations}
      </div>
      {
        !collapsedMerged && children
      }
    </>
  )
}

export default Collapse
