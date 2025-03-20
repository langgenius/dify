import { memo } from 'react'
import {
  RiHashtag,
  RiTextSnippet,
  RiTimeLine,
} from '@remixicon/react'
import { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import cn from '@/utils/classnames'

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
        type === MetadataFilteringVariableType.string && (
          <RiTextSnippet className={cn('w-3.5 h-3.5', className)} />
        )
      }
      {
        type === MetadataFilteringVariableType.number && (
          <RiHashtag className={cn('w-3.5 h-3.5', className)} />
        )
      }
      {
        type === MetadataFilteringVariableType.time && (
          <RiTimeLine className={cn('w-3.5 h-3.5', className)} />
        )
      }
    </>
  )
}

export default memo(MetadataIcon)
