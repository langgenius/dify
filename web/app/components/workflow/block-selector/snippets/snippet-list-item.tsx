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
        'flex cursor-pointer flex-col gap-1 rounded-xl px-3 py-2',
        isHovered && 'bg-background-default-hover',
        className,
      )}
      {...props}
    >
      <div className="w-full truncate system-md-semibold text-text-secondary">
        {snippet.name}
      </div>
      {!!snippet.description && (
        <div className="line-clamp-1 w-full system-sm-regular text-text-tertiary">
          {snippet.description}
        </div>
      )}
    </div>
  )
}

export default SnippetListItem
