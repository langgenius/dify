import { BreadcrumbSeparator, BreadcrumbItem as PathItem } from '@langgenius/dify-ui/breadcrumb'
import { cn } from '@langgenius/dify-ui/cn'

type BreadcrumbItemProps = {
  name: string
  onClick: () => void
  current?: boolean
  title?: string
}

export default function BreadcrumbItem({
  name,
  onClick,
  current = false,
  title,
}: BreadcrumbItemProps) {
  return (
    <>
      <PathItem>
        <button
          type="button"
          aria-current={current ? 'location' : undefined}
          className={cn(
            'truncate rounded-md px-1.25 py-1 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
            current
              ? 'system-sm-medium text-text-secondary'
              : 'system-sm-regular text-text-tertiary hover:bg-state-base-hover',
          )}
          disabled={current}
          onClick={onClick}
          title={title}
        >
          {name}
        </button>
      </PathItem>
      {!current && <BreadcrumbSeparator className="system-xs-regular text-divider-deep" />}
    </>
  )
}
