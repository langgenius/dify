'use client'

import type { Role } from '../role-list'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import PermissionField from './permission-field'

export type RoleModalMode = 'create' | 'view' | 'edit'

export type RoleModalRole = Role & {
  permissions?: string[]
}

export type RoleModalProps = {
  mode: RoleModalMode
  open: boolean
  role?: RoleModalRole
  onClose: () => void
  onSubmit?: (data: { name: string, description: string, permissions: string[] }) => void
}

const TITLES: Record<RoleModalMode, { title: string, description: string }> = {
  create: {
    title: 'Create Role',
    description: 'Create a role and assign permissions',
  },
  edit: {
    title: 'Edit Role',
    description: 'Edit role details and permissions',
  },
  view: {
    title: 'View Role',
    description: 'View role details and permissions',
  },
}

const RoleModal = ({
  mode,
  open,
  role,
  onClose,
  onSubmit,
}: RoleModalProps) => {
  const [name, setName] = useState(role?.name ?? '')
  const [desc, setDesc] = useState(role?.description ?? '')
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? [])

  const readonly = mode === 'view'
  const { title, description } = TITLES[mode]

  const handleSubmit = () => {
    onSubmit?.({ name: name.trim(), description: desc.trim(), permissions })
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <DialogContent
        className="w-[560px] overflow-visible p-0"
        backdropProps={{ forceRender: true }}
      >
        <div className="relative px-6 pt-6 pb-4">
          <DialogCloseButton />
          <div className="pr-8">
            <DialogTitle className="system-xl-semibold text-text-primary">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
              {description}
            </DialogDescription>
          </div>
        </div>
        <div className="border-t border-divider-subtle" />
        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="role-name" className="system-sm-medium text-text-secondary">
              Role name
            </label>
            <Input
              id="role-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Marketing Lead"
              disabled={readonly}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="role-description" className="system-sm-medium text-text-secondary">
              Description
            </label>
            <Textarea
              id="role-description"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Describe what this role is responsible for"
              disabled={readonly}
              className="min-h-24 resize-none"
            />
          </div>
          <PermissionField
            value={permissions}
            onChange={setPermissions}
            readonly={readonly}
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-divider-subtle px-6 py-4">
          <a
            href="https://docs.dify.ai/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 system-xs-medium text-text-accent hover:underline"
          >
            <span>Learn more about permissions</span>
            <span aria-hidden className="i-ri-external-link-line h-3.5 w-3.5" />
          </a>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              {readonly ? 'Close' : 'Cancel'}
            </Button>
            {!readonly && (
              <Button
                variant="primary"
                disabled={!name.trim()}
                onClick={handleSubmit}
              >
                Confirm
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default RoleModal
