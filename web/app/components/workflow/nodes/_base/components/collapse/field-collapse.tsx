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
          <div className='flex items-center h-6 system-sm-semibold-uppercase text-text-secondary cursor-pointer'>{title}</div>
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
