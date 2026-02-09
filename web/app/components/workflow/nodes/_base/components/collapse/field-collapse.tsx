import type { ReactNode } from 'react'
import { cn } from '@/utils/classnames'
import Collapse from '.'

type FieldCollapseProps = {
  title: string | React.JSX.Element
  children: ReactNode
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
  operations?: ReactNode
  noXSpacing?: boolean
}
const FieldCollapse = ({
  title,
  children,
  collapsed,
  onCollapse,
  operations,
  noXSpacing,
}: FieldCollapseProps) => {
  return (
    <div className="py-4">
      <Collapse
        trigger={
          <div className="flex h-6 cursor-pointer items-center text-text-secondary system-sm-semibold-uppercase">{title}</div>
        }
        operations={operations}
        collapsed={collapsed}
        onCollapse={onCollapse}
        noXSpacing={noXSpacing}
      >
        <div className={cn('px-4', noXSpacing && 'px-0')}>
          {children}
        </div>
      </Collapse>
    </div>
  )
}

export default FieldCollapse
