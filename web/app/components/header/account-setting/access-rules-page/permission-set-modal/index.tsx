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
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PermissionPicker from './permission-picker'

export type PermissionSetModalMode = 'create' | 'edit' | 'view'

export type PermissionSetFormValues = {
  name: string
  description: string
  permissionKeys: string[]
}

type PermissionSetModalProps = {
  open: boolean
  mode: PermissionSetModalMode
  resourceType: AccessPolicyResourceType
  initialValues?: Partial<PermissionSetFormValues>
  onClose: () => void
  onSubmit: (values: PermissionSetFormValues) => void
}

type PermissionSetModalBodyProps = Omit<PermissionSetModalProps, 'open'>

const PermissionSetModalBody = ({
  mode,
  resourceType,
  initialValues,
  onClose,
  onSubmit,
}: PermissionSetModalBodyProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(initialValues?.name ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [permissionKeys, setPermissionKeys] = useState<string[]>(initialValues?.permissionKeys ?? [])

  const trimmedName = name.trim()
  const readonly = mode === 'view'
  const canSubmit = trimmedName.length > 0

  const handleConfirm = () => {
    if (readonly || !canSubmit)
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
      className="flex h-[85vh] w-140 flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            {t(`permissionSet.modal.${mode}.${resourceType}.title`, { ns: 'permission' })}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(`permissionSet.modal.${mode}.${resourceType}.description`, { ns: 'permission' })}
          </DialogDescription>
        </div>
      </div>

      <div className="border-t border-divider-subtle" />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-hidden px-6 py-5">
        <div className="flex shrink-0 flex-col gap-1">
          <label htmlFor="permission-set-name" className="system-sm-medium text-text-secondary">
            {t('permissionSet.nameLabel', { ns: 'permission' })}
            <span aria-hidden className="ml-0.5 text-text-destructive">*</span>
          </label>
          <Input
            id="permission-set-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('permissionSet.namePlaceholder', { ns: 'permission' })}
            disabled={readonly}
          />
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <label htmlFor="permission-set-description" className="system-sm-medium text-text-secondary">
            {t('permissionSet.descriptionLabel', { ns: 'permission' })}
          </label>
          <Textarea
            id="permission-set-description"
            value={description}
            onValueChange={value => setDescription(value)}
            placeholder={t('permissionSet.descriptionPlaceholder', { ns: 'permission' })}
            className="min-h-20 resize-none"
            disabled={readonly}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="system-sm-medium text-text-secondary">{t('permissionSet.permissions', { ns: 'permission' })}</div>
          <PermissionPicker
            resourceType={resourceType}
            value={permissionKeys}
            onChange={setPermissionKeys}
            readonly={readonly}
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
          <span>{t('permissionSet.learnMore', { ns: 'permission' })}</span>
          <span aria-hidden className="i-ri-external-link-line h-3.5 w-3.5" />
        </a>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {readonly ? t('operation.close', { ns: 'common' }) : t('operation.cancel', { ns: 'common' })}
          </Button>
          {!readonly && (
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={handleConfirm}
            >
              {t('operation.confirm', { ns: 'common' })}
            </Button>
          )}
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
