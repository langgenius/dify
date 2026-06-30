'use client'

import type { Role } from '@/models/access-control'
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
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PermissionField from './permission-field'

export type RoleModalMode = 'create' | 'view' | 'edit'

export type submitRoleData = {
  name: string
  description?: string
  permissionKeys?: string[]
}

type RoleModalProps = {
  mode: RoleModalMode
  open: boolean
  role?: Role
  onClose: () => void
  onSubmit?: (data: submitRoleData) => void
}

const RoleModal = ({
  mode,
  open,
  role,
  onClose,
  onSubmit,
}: RoleModalProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(role?.name ?? '')
  const [desc, setDesc] = useState(role?.description ?? '')
  const [permissionKeys, setPermissionKeys] = useState<string[]>(role?.permission_keys ?? [])

  const readonly = mode === 'view'

  const onRoleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
  }, [])

  const onRoleDescChange = useCallback((value: string) => {
    setDesc(value)
  }, [])

  const handleSubmit = () => {
    onSubmit?.({ name: name.trim(), description: desc.trim(), permissionKeys })
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
        className="flex h-[85vh] w-140 flex-col overflow-hidden p-0"
        backdropProps={{ forceRender: true }}
      >
        <div className="relative shrink-0 px-6 pt-6 pb-4">
          <DialogCloseButton />
          <div className="pr-8">
            <DialogTitle className="system-xl-semibold text-text-primary">
              {t(`role.modal.${mode}.title`, { ns: 'permission' })}
            </DialogTitle>
            <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
              {t(`role.modal.${mode}.description`, { ns: 'permission' })}
            </DialogDescription>
          </div>
        </div>
        <div className="border-t border-divider-subtle" />
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-hidden px-6 py-5">
          <div className="flex shrink-0 flex-col gap-1">
            <label htmlFor="role-name" className="system-sm-medium text-text-secondary">
              {t('role.modal.nameLabel', { ns: 'permission' })}
            </label>
            <Input
              id="role-name"
              value={name}
              onChange={onRoleNameChange}
              placeholder={t('role.modal.namePlaceholder', { ns: 'permission' })}
              disabled={readonly}
            />
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <label htmlFor="role-description" className="system-sm-medium text-text-secondary">
              {t('role.modal.descriptionLabel', { ns: 'permission' })}
            </label>
            <Textarea
              id="role-description"
              value={desc}
              onValueChange={onRoleDescChange}
              placeholder={t('role.modal.descriptionPlaceholder', { ns: 'permission' })}
              disabled={readonly}
              className="min-h-24 resize-none"
            />
          </div>
          <PermissionField
            value={permissionKeys}
            onChange={setPermissionKeys}
            readonly={readonly}
          />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-6 py-4">
          <a
            href="https://enterprise-docs.dify.ai/en/3.11.x/use/workspace/permission-reference"
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
                disabled={!name.trim()}
                onClick={handleSubmit}
              >
                {t('operation.confirm', { ns: 'common' })}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default RoleModal
