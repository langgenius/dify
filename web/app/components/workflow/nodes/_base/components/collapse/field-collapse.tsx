import type { ReactNode } from 'react'
import Collapse from '.'

type FieldCollapseProps = {
  title: string
  children: ReactNode
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
  operations?: ReactNode
}
const FieldCollapse = ({
  title,
  children,
  collapsed,
  onCollapse,
  operations,
}: FieldCollapseProps) => {
  return (
    <div className="py-4">
      <Collapse
        trigger={
          <div className="system-sm-semibold-uppercase flex h-6 cursor-pointer items-center text-text-secondary">{title}</div>
        }
        operations={operations}
        collapsed={collapsed}
        onCollapse={onCollapse}
      >
        <div className="px-4">
          {children}
        </div>
      </Collapse>
    </div>
  )
}

export default FieldCollapse
