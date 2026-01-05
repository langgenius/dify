import type { ReactNode } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

const Placeholder = ({
  compact,
  value,
  className,
}: {
  compact?: boolean
  value?: ReactNode
  className?: string
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(
      'pointer-events-none absolute left-0 top-0 h-full w-full select-none text-sm text-components-input-text-placeholder',
      compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
      className,
    )}
    >
      {value || t('promptEditor.placeholder', { ns: 'common' })}
    </div>
  )
}

export default memo(Placeholder)
