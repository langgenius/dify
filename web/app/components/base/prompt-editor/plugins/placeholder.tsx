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
      'absolute top-0 left-0 h-full w-full text-sm text-gray-300 select-none pointer-events-none',
      compact ? 'leading-5 text-[13px]' : 'leading-6 text-sm',
    )}>
      {value || t('common.promptEditor.placeholder')}
    </div>
  )
}

export default memo(Placeholder)
