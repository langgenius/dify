import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

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
      'pointer-events-none absolute top-0 left-0 h-full w-full text-sm text-components-input-text-placeholder select-none',
      compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
      className,
    )}
    >
      {value || t('promptEditor.placeholder', { ns: 'common' })}
    </div>
  )
}

export default memo(Placeholder)
