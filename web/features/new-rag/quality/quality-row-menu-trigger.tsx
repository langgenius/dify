import { DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'

export function QualityRowMenuTrigger({ disabled, label }: { disabled?: boolean; label: string }) {
  return (
    <DropdownMenuTrigger
      aria-label={label}
      disabled={disabled}
      className="ml-auto flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
    >
      <span aria-hidden className="i-ri-more-fill size-4.5" />
    </DropdownMenuTrigger>
  )
}
