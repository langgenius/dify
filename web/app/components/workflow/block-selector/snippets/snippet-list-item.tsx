import type { ComponentPropsWithoutRef, Ref } from 'react'
import type { SnippetListItem as SnippetListItemData } from '@/types/snippet'
import { cn } from '@langgenius/dify-ui/cn'

type SnippetListItemProps = {
  ref?: Ref<HTMLButtonElement>
  snippet: SnippetListItemData
} & ComponentPropsWithoutRef<'button'>

const SnippetListItem = ({ snippet, className, ref, ...props }: SnippetListItemProps) => (
  <button
    type="button"
    ref={ref}
    className={cn(
      'flex w-full cursor-pointer flex-col gap-1 rounded-xl border-0 bg-transparent px-3 py-2 text-left outline-hidden hover:bg-background-default-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid data-popup-open:bg-background-default-hover',
      className,
    )}
    {...props}
  >
    <div className="w-full truncate system-md-semibold text-text-secondary">{snippet.name}</div>
    {!!snippet.description && (
      <div className="line-clamp-1 w-full system-sm-regular text-text-tertiary">
        {snippet.description}
      </div>
    )}
  </button>
)

export default SnippetListItem
