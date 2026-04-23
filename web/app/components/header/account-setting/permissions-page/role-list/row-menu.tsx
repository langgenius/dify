'use client'
import type { Role, RoleType } from '.'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useCallback, useState } from 'react'
import ActionButton from '@/app/components/base/action-button'

type RowMenuProps = {
  roleType: RoleType
  role: Role
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
  onDelete?: (role: Role) => void
}

const RowMenu = ({
  roleType,
  role,
  onView,
  onEdit,
  onDelete,
}: RowMenuProps) => {
  const [open, setOpen] = useState(false)

  const handleView = useCallback(() => onView?.(role), [onView, role])

  const handleEdit = useCallback(() => onEdit?.(role), [onEdit, role])

  const handleDuplicate = useCallback(() => {
    // TODO: wire up to API when backend is ready
  }, [])

  const handleDelete = useCallback(() => onDelete?.(role), [onDelete, role])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<ActionButton size="l" className={open ? 'bg-state-base-hover' : ''} aria-label="More actions" />}>
        <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-[160px]">
        {
          roleType === 'system' && (
            <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleView}>
              View
            </DropdownMenuItem>
          )
        }
        {
          roleType === 'custom' && (
            <>
              <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleEdit}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleDuplicate}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="system-sm-semibold" onClick={handleDelete}>
                Delete
              </DropdownMenuItem>
            </>
          )
        }
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default RowMenu
