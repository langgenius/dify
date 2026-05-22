import type {
  ComponentPropsWithoutRef,
  Ref,
} from 'react'
import type { PublishedSnippetListItem } from './snippet-detail-card'
import { cn } from '@langgenius/dify-ui/cn'

type SnippetListItemProps = {
  isHovered: boolean
  ref?: Ref<HTMLDivElement>
  snippet: PublishedSnippetListItem
} & ComponentPropsWithoutRef<'div'>

const SnippetListItem = ({
  isHovered,
  snippet,
  className,
  ref,
  ...props
}: SnippetListItemProps) => {
  return (
    <div
      ref={ref}
      className={cn(
        'flex h-8 cursor-pointer items-center rounded-lg px-3',
        isHovered && 'bg-background-default-hover',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 system-sm-medium text-text-secondary">
        {snippet.name}
      </div>
    </div>
  )
}

export default SnippetListItem
