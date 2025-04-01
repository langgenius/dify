import type { ReactNode } from 'react'
import { useState } from 'react'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
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
      <div className='group/collapse flex items-center'>
        <div
          className='ml-4 flex grow items-center'
          onClick={() => {
            if (!disabled) {
              setCollapsedLocal(!collapsedMerged)
              onCollapse?.(!collapsedMerged)
            }
          }}
        >
          {trigger}
          <div className='h-4 w-4 shrink-0'>
            {
              !disabled && (
                <ArrowDownRoundFill
                  className={cn(
                    'h-4 w-4 cursor-pointer text-text-quaternary group-hover/collapse:text-text-secondary',
                    collapsedMerged && 'rotate-[270deg]',
                  )}
                />
              )
            }
          </div>
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
