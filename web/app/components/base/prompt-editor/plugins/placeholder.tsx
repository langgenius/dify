import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { getTextFromReactNode } from '@/utils/react'

const Placeholder = ({
  compact,
  value,
  className,
  title,
}: {
  compact?: boolean
  value?: ReactNode
  className?: string
  title?: string
}) => {
  const { t } = useTranslation()
  const resolvedValue = value || t(($) => $['promptEditor.placeholder'], { ns: 'common' })

  return (
    <div
      className={cn(
        'pointer-events-none absolute top-0 left-0 size-full text-sm text-components-input-text-placeholder select-none',
        compact ? 'text-[13px] leading-5' : 'text-sm/6',
        className,
      )}
      title={title ?? getTextFromReactNode(resolvedValue)}
    >
      {resolvedValue}
    </div>
  )
}

export default memo(Placeholder)
