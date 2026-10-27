import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export const renderTdValue = (value: string | number | null, isEmptyStyle = false): ReactNode => {
  const className = cn(
    isEmptyStyle ? 'text-text-tertiary' : 'text-text-secondary',
    'truncate text-sm',
  )

  return <div className={className}>{value ?? '-'}</div>
}
