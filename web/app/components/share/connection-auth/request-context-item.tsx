import { cn } from '@langgenius/dify-ui/cn'

export default function RequestContextItem({
  iconClassName,
  text,
}: {
  iconClassName: string
  text: string
}) {
  return (
    <div className="flex items-center gap-3 p-3">
      <span
        className={cn('size-4 shrink-0 text-text-secondary', iconClassName)}
        aria-hidden="true"
      />
      <p className="system-sm-medium wrap-anywhere text-text-primary">{text}</p>
    </div>
  )
}
