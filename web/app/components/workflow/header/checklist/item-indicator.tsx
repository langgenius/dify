import { cn } from '@langgenius/dify-ui/cn'

type ItemIndicatorProps = {
  className?: string
}

export const ItemIndicator = ({ className }: ItemIndicatorProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="24"
      viewBox="0 0 20 24"
      fill="none"
      className={cn('shrink-0', className)}
    >
      <path d="M9.5 0H10.5V24H9.5V0Z" fill="currentColor" className="text-divider-regular" />
      <circle cx="10" cy="12" r="3.25" fill="#F79009" stroke="white" strokeWidth="1.5" />
    </svg>
  )
}
