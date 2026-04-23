'use client'

import type { PermissionGroup } from './permissions-data'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useEffect, useMemo, useRef, useState } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import { PERMISSION_GROUPS } from './permissions-data'

type PermissionPickerProps = {
  value: string[]
  onChange: (next: string[]) => void
  className?: string
}

const PermissionPicker = ({ value, onChange, className }: PermissionPickerProps) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Base UI Menu's FloatingFocusManager hard-codes `initialFocus: true` for top-level
  // menus, which steals focus from the trigger input on open. Re-focus the input on the
  // next tick so the user can keep typing to filter permissions.
  useEffect(() => {
    if (!open)
      return
    const timer = setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  const filteredGroups = useMemo<PermissionGroup[]>(() => {
    const q = search.trim().toLowerCase()
    if (!q)
      return PERMISSION_GROUPS
    return PERMISSION_GROUPS
      .map(group => ({
        ...group,
        items: group.items.filter(i => i.name.toLowerCase().includes(q)),
      }))
      .filter(group => group.items.length > 0)
  }, [search])

  const selectedSet = useMemo(() => new Set(value), [value])

  const togglePermission = (id: string) => {
    if (selectedSet.has(id))
      onChange(value.filter(v => v !== id))
    else
      onChange([...value, id])
  }

  const getGroupState = (group: PermissionGroup) => {
    const checkedCount = group.items.reduce(
      (acc, i) => acc + (selectedSet.has(i.id) ? 1 : 0),
      0,
    )
    return {
      allChecked: checkedCount > 0 && checkedCount === group.items.length,
      indeterminate: checkedCount > 0 && checkedCount < group.items.length,
    }
  }

  const toggleGroup = (group: PermissionGroup) => {
    const { allChecked, indeterminate } = getGroupState(group)
    const ids = group.items.map(i => i.id)
    if (allChecked || indeterminate) {
      const idSet = new Set(ids)
      onChange(value.filter(v => !idSet.has(v)))
    }
    else {
      const next = new Set(value)
      ids.forEach(id => next.add(id))
      onChange(Array.from(next))
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger>
        <div
          className={cn(
            'flex cursor-text items-center gap-2 rounded-lg bg-components-input-bg-normal px-3 py-2 hover:bg-components-input-bg-hover',
            open && 'bg-components-input-bg-active shadow-xs ring-[0.5px] ring-components-input-border-active',
            className,
          )}
        >
          <span aria-hidden className="i-ri-search-line h-4 w-4 shrink-0 text-text-tertiary" />
          <input
            ref={inputRef}
            className="min-w-0 grow appearance-none bg-transparent system-sm-regular text-text-primary caret-primary-600 outline-hidden placeholder:text-text-tertiary"
            placeholder="Search permissions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape')
                setOpen(false)
            }}
          />
          <span
            aria-hidden
            className={cn(
              'i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary transition-transform',
              open && 'rotate-180',
            )}
          />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="max-h-80 w-[var(--anchor-width)]"
      >
        {filteredGroups.length === 0 && (
          <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
            No permissions found
          </div>
        )}
        {filteredGroups.map((group, groupIndex) => {
          const { allChecked, indeterminate } = getGroupState(group)
          return (
            <DropdownMenuGroup key={group.id}>
              {groupIndex > 0 && <DropdownMenuSeparator />}
              <button
                type="button"
                className="mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover"
                onClick={() => toggleGroup(group)}
              >
                <Checkbox
                  checked={allChecked}
                  indeterminate={indeterminate}
                  className="pointer-events-none"
                />
                <span className="system-xs-medium-uppercase tracking-wide text-text-tertiary">
                  {group.label}
                </span>
              </button>
              {group.items.map((item) => {
                const checked = selectedSet.has(item.id)
                return (
                  <DropdownMenuCheckboxItem
                    key={item.id}
                    checked={checked}
                    onCheckedChange={() => togglePermission(item.id)}
                    className="gap-2 pl-6"
                  >
                    <Checkbox checked={checked} className="pointer-events-none" />
                    <span className="system-sm-regular text-text-secondary">
                      {item.name}
                    </span>
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuGroup>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PermissionPicker
