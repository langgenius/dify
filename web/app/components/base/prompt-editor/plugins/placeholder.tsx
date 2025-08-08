import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

const Placeholder = ({
  compact,
  value,
  className,
}: {
  compact?: boolean
  value?: string | JSX.Element
  className?: string
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(
      className,
      'pointer-events-none absolute left-0 top-0 h-full w-full select-none text-sm text-components-input-text-placeholder',
      compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
    )}>
      {value || t('common.promptEditor.placeholder')}
    </div>
  )
}

export default memo(Placeholder)
