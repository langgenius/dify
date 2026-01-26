import { memo } from 'react'
import { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { cn } from '@/utils/classnames'

type MetadataIconProps = {
  type?: MetadataFilteringVariableType
  className?: string
}
const MetadataIcon = ({
  type,
  className,
}: MetadataIconProps) => {
  return (
    <>
      {
        (type === MetadataFilteringVariableType.string || type === MetadataFilteringVariableType.select) && (
          <span className={`i-ri-text-snippet ${cn('h-3.5 w-3.5', className)}`} />
        )
      }
      {
        type === MetadataFilteringVariableType.number && (
          <span className={`i-ri-hashtag ${cn('h-3.5 w-3.5', className)}`} />
        )
      }
      {
        type === MetadataFilteringVariableType.time && (
          <span className={`i-ri-time-line ${cn('h-3.5 w-3.5', className)}`} />
        )
      }
    </>
  )
}

export default memo(MetadataIcon)
