import type {
  ComponentPropsWithoutRef,
  Ref,
} from 'react'
import type { PublishedSnippetListItem } from './snippet-detail-card'
import { cn } from '@langgenius/dify-ui/cn'
import AppIcon from '@/app/components/base/app-icon'

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
        'flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3',
        isHovered && 'bg-background-default-hover',
        className,
      )}
      {...props}
    >
      <AppIcon
        size="tiny"
        iconType={snippet.icon_info.icon_type}
        icon={snippet.icon_info.icon}
        background={snippet.icon_info.icon_background}
        imageUrl={snippet.icon_info.icon_url}
      />
      <div className="system-sm-medium min-w-0 text-text-secondary">
        {snippet.name}
      </div>
      {isHovered && snippet.author && (
        <div className="system-xs-regular ml-auto text-text-tertiary">
          {snippet.author}
        </div>
      )}
    </div>
  )
}

export default SnippetListItem
