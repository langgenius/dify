'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type EnvironmentMode = 'shared' | 'isolated'

const baseBadge = 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 system-xs-medium whitespace-nowrap'

export function ModeBadge({ mode, className }: {
  mode: EnvironmentMode
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const style = mode === 'shared'
    ? 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700'
    : 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700'
  return (
    <span className={cn(baseBadge, style, className)}>
      {t(mode === 'shared' ? 'mode.shared' : 'mode.isolated')}
    </span>
  )
}
