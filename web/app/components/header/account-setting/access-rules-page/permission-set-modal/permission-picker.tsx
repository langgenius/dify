'use client'

import type { PermissionGroup, ResourceType } from './permissions-data'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useEffect, useMemo, useRef, useState } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import {
  filterPermissionNodes,
  PERMISSION_NODES_BY_RESOURCE,
} from './permissions-data'

type PermissionPickerProps = {
  resourceType: ResourceType
  value: string[]
  onChange: (next: string[]) => void
  className?: string
}

const PermissionPicker = ({
  resourceType,
  value,
  onChange,
  className,
}: PermissionPickerProps) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-focus the search input after the dropdown takes over focus, so the user
  // can keep typing to filter permissions.
  useEffect(() => {
    if (!open)
      return
    const timer = setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  const nodes = PERMISSION_NODES_BY_RESOURCE[resourceType]

  const filtered = useMemo(
    () => filterPermissionNodes(nodes, search),
    [nodes, search],
  )

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
        popupClassName="max-h-80 w-[var(--anchor-width)] py-1"
      >
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
            No permissions found
          </div>
        )}
        {filtered.map((node) => {
          if (node.kind === 'leaf') {
            const checked = selectedSet.has(node.leaf.id)
            return (
              <button
                key={node.leaf.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => togglePermission(node.leaf.id)}
                className="mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover"
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="system-sm-regular text-text-secondary">
                  {node.leaf.name}
                </span>
              </button>
            )
          }
          const { allChecked, indeterminate } = getGroupState(node.group)
          return (
            <div key={node.group.id} className="flex flex-col">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={allChecked ? true : indeterminate ? 'mixed' : false}
                onClick={() => toggleGroup(node.group)}
                className="mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover"
              >
                <Checkbox
                  checked={allChecked}
                  indeterminate={indeterminate}
                  className="pointer-events-none"
                />
                <span className="system-sm-regular text-text-secondary">
                  {node.group.label}
                </span>
              </button>
              {node.group.items.map((item) => {
                const checked = selectedSet.has(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => togglePermission(item.id)}
                    className={cn(
                      'mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg pr-2 pl-7 text-left outline-hidden hover:bg-state-base-hover',
                      checked && 'bg-state-accent-hover hover:bg-state-accent-hover',
                    )}
                  >
                    <Checkbox checked={checked} className="pointer-events-none" />
                    <span className="system-sm-regular text-text-secondary">
                      {item.name}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PermissionPicker
