'use client'

import type { ResourceType } from './permissions-data'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useMemo, useState } from 'react'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import PermissionPicker from './permission-picker'
import { getPermissionMap } from './permissions-data'

export type PermissionSetModalMode = 'create' | 'edit'

export type PermissionSetFormValues = {
  name: string
  description: string
  permissions: string[]
}

export type PermissionSetModalProps = {
  open: boolean
  mode: PermissionSetModalMode
  resourceType: ResourceType
  initialValues?: Partial<PermissionSetFormValues>
  onClose: () => void
  onSubmit: (values: PermissionSetFormValues) => void
}

const RESOURCE_LABEL: Record<ResourceType, string> = {
  app: 'App',
  knowledge_base: 'Knowledge Base',
}

const buildTitle = (mode: PermissionSetModalMode, resource: ResourceType): string => {
  const verb = mode === 'create' ? 'Create' : 'Edit'
  return `${verb} ${RESOURCE_LABEL[resource]} permission set`
}

const buildDescription = (mode: PermissionSetModalMode, resource: ResourceType): string => {
  if (mode === 'edit')
    return 'Modify the name, description, and permissions granted for this permission set.'
  if (resource === 'app')
    return 'Create an app permission set that can be referenced in access rules for quick authorization.'
  return 'Create a knowledge base permission set that can be referenced in access rules for quick authorization.'
}

type PermissionSetModalBodyProps = Omit<PermissionSetModalProps, 'open'>

const PermissionSetModalBody = ({
  mode,
  resourceType,
  initialValues,
  onClose,
  onSubmit,
}: PermissionSetModalBodyProps) => {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [permissions, setPermissions] = useState<string[]>(initialValues?.permissions ?? [])

  const permissionMap = useMemo(() => getPermissionMap(resourceType), [resourceType])

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0

  const handleConfirm = () => {
    if (!canSubmit)
      return
    onSubmit({
      name: trimmedName,
      description: description.trim(),
      permissions,
    })
    onClose()
  }

  const handleRemovePermission = (id: string) => {
    setPermissions(prev => prev.filter(p => p !== id))
  }

  return (
    <DialogContent
      className="max-h-[85vh] w-[560px] overflow-visible p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            {buildTitle(mode, resourceType)}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {buildDescription(mode, resourceType)}
          </DialogDescription>
        </div>
      </div>

      <div className="border-t border-divider-subtle" />

      <div className="flex flex-col gap-5 px-6 py-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="permission-set-name" className="system-sm-medium text-text-secondary">
            permission set name
            <span aria-hidden className="ml-0.5 text-text-destructive">*</span>
          </label>
          <Input
            id="permission-set-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Can export DSL"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="permission-set-description" className="system-sm-medium text-text-secondary">
            Description
          </label>
          <Textarea
            id="permission-set-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe what this permission set grants"
            className="min-h-20 resize-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="system-sm-medium text-text-secondary">Permissions</div>
          {permissions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {permissions.map((id) => {
                const p = permissionMap[id]
                if (!p)
                  return null
                return (
                  <span
                    key={id}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md bg-util-colors-indigo-indigo-50 px-1.5 py-0.5 system-xs-medium text-text-accent',
                      'border-[0.5px] border-components-panel-border',
                    )}
                  >
                    <span>{p.name}</span>
                    <button
                      type="button"
                      className="flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-state-base-hover"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => handleRemovePermission(id)}
                    >
                      <span aria-hidden className="i-ri-close-line h-3 w-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
          <PermissionPicker
            resourceType={resourceType}
            value={permissions}
            onChange={setPermissions}
          />
        </div>
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
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={handleConfirm}
          >
            Confirm
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}

const PermissionSetModal = ({
  open,
  mode,
  resourceType,
  initialValues,
  onClose,
  onSubmit,
}: PermissionSetModalProps) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <PermissionSetModalBody
        mode={mode}
        resourceType={resourceType}
        initialValues={initialValues}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </Dialog>
  )
}

export default PermissionSetModal
