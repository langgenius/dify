import type { PublisherEnvironment } from './types'
import { DropdownMenuItem } from '@langgenius/dify-ui/dropdown-menu'

export function EnvironmentMenuItem({
  environment,
  onClick,
}: {
  environment: PublisherEnvironment
  onClick: () => void
}) {
  return (
    <DropdownMenuItem className="mx-0 flex gap-2 px-2 py-1.5" onClick={onClick}>
      <span aria-hidden className="i-ri-instance-line size-4 shrink-0 text-text-tertiary" />
      <span className="grow truncate system-md-regular text-text-secondary">
        {environment.name}
      </span>
    </DropdownMenuItem>
  )
}
