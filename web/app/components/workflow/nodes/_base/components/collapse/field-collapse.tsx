import type { ReactNode } from 'react'
import Collapse from '.'

type FieldCollapseProps = {
  title: string
  children: ReactNode
}
const FieldCollapse = ({
  title,
  children,
}: FieldCollapseProps) => {
  return (
    <div className='py-4'>
      <Collapse
        trigger={
          <div className='system-sm-semibold-uppercase text-text-secondary flex h-6 cursor-pointer items-center'>{title}</div>
        }
      >
        <div className='px-4'>
          {children}
        </div>
      </Collapse>
    </div>
  )
}

export default FieldCollapse
