'use client'

import type { AccessPolicyResourceType } from '@/models/access-control'
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
import PermissionPicker from './permission-picker'

export type PermissionSetModalMode = 'create' | 'edit'

export type PermissionSetFormValues = {
  name: string
  description: string
  permissionKeys: string[]
}

export type PermissionSetModalProps = {
  open: boolean
  mode: PermissionSetModalMode
  resourceType: AccessPolicyResourceType
  initialValues?: Partial<PermissionSetFormValues>
  onClose: () => void
  onSubmit: (values: PermissionSetFormValues) => void
}

const RESOURCE_LABEL: Record<AccessPolicyResourceType, string> = {
  app: 'App',
  dataset: 'Knowledge Base',
}

const buildTitle = (mode: PermissionSetModalMode, resource: AccessPolicyResourceType): string => {
  const verb = mode === 'create' ? 'Create' : 'Edit'
  return `${verb} ${RESOURCE_LABEL[resource]} permission set`
}

const buildDescription = (mode: PermissionSetModalMode, resource: AccessPolicyResourceType): string => {
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
  const [permissionKeys, setPermissionKeys] = useState<string[]>(initialValues?.permissionKeys ?? [])

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0

  const handleConfirm = () => {
    if (!canSubmit)
      return
    onSubmit({
      name: trimmedName,
      description: description.trim(),
      permissionKeys,
    })
    onClose()
  }

  return (
    <DialogContent
      className="flex max-h-[85vh] w-140 flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
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

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-hidden px-6 py-5">
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
          <PermissionPicker
            resourceType={resourceType}
            value={permissionKeys}
            onChange={setPermissionKeys}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-6 py-4">
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
