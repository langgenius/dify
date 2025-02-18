import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

const Placeholder = ({
  compact,
  value,
  className,
}: {
  compact?: boolean
  value?: string
  className?: string
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(
      className,
      'text-components-input-text-placeholder pointer-events-none absolute left-0 top-0 h-full w-full select-none text-sm',
      compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
    )}>
      {value || t('common.promptEditor.placeholder')}
    </div>
  )
}

export default memo(Placeholder)
