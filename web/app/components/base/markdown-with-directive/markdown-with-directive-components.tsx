import type { ReactNode } from 'react'
import type { WithIconItemDirectiveProps, WithIconListDirectiveProps } from './markdown-with-directive-schema'

type WithIconListProps = WithIconListDirectiveProps & {
  children?: ReactNode
  className?: string
}

type WithIconItemProps = WithIconItemDirectiveProps & {
  children?: ReactNode
}

export function WithIconList({ children, mt, className }: WithIconListProps) {
  const classValue = className || ''
  const classMarginTop = classValue.includes('mt-4') ? 16 : 0

  return (
    <div style={{ marginTop: Number(mt || classMarginTop) }}>
      <div style={{ padding: 16 }}>
        {children}
      </div>
    </div>
  )
}

export function WithIconItem({ icon, b, children }: WithIconItemProps) {
  return (
    <div style={{ display: 'flex', border: '1px solid #ddd', gap: 8 }}>
      <span>🔹</span>
      {b && <span>{b}</span>}
      <span>{children}</span>
      <small style={{ color: '#999' }}>
        {`(${icon})`}
      </small>
    </div>
  )
}
