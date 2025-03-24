import type { ReactNode } from 'react'
import Collapse from '.'

type FieldCollapseProps = {
  title: string
  children: ReactNode
  operations?: ReactNode
}
const FieldCollapse = ({
  title,
  children,
  operations,
}: FieldCollapseProps) => {
  return (
    <div className='py-4'>
      <Collapse
        trigger={
          <div className='system-sm-semibold-uppercase flex h-6 cursor-pointer items-center text-text-secondary'>{title}</div>
        }
        operations={operations}
      >
        <div className='px-4'>
          {children}
        </div>
      </Collapse>
    </div>
  )
}

export default FieldCollapse
