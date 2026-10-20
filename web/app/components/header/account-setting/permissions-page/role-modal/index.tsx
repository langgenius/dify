'use client'
import type { Role } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { getEnterpriseDocUrl } from '@/context/i18n'
import { getDocLanguage } from '@/i18n/language'
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
  onSubmit?: (data: submitRoleData) => void | Promise<void>
}

const RoleModal = ({ mode, open, role, onClose, onSubmit }: RoleModalProps) => {
  const { t } = useTranslation(['common', 'permission'])
  const locale = useLocale()
  const docLanguage = getDocLanguage(locale)
  const [name, setName] = useState(role?.name ?? '')
  const [desc, setDesc] = useState(role?.description ?? '')
  const [permissionKeys, setPermissionKeys] = useState<string[]>(role?.permission_keys ?? [])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const readonly = mode === 'view'

  const onRoleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
  }, [])

  const onRoleDescChange = useCallback((value: string) => {
    setDesc(value)
  }, [])

  const handleSubmit = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit?.({ name: name.trim(), description: desc.trim(), permissionKeys })
      onClose()
    } catch {
      // The mutation reports the error; keep the draft available for retry.
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent className="h-[85vh] w-140" backdropProps={{ forceRender: true }}>
        <DialogHeader>
          <DialogTitle>{t(($) => $[`role.modal.${mode}.title`], { ns: 'permission' })}</DialogTitle>
          <DialogDescription>
            {t(($) => $[`role.modal.${mode}.description`], { ns: 'permission' })}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <div className="flex shrink-0 flex-col gap-1">
            <label htmlFor="role-name" className="system-sm-medium text-text-secondary">
              {t(($) => $['role.modal.nameLabel'], { ns: 'permission' })}
            </label>
            <Input
              id="role-name"
              value={name}
              onChange={onRoleNameChange}
              placeholder={t(($) => $['role.modal.namePlaceholder'], { ns: 'permission' })}
              disabled={readonly}
            />
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <label htmlFor="role-description" className="system-sm-medium text-text-secondary">
              {t(($) => $['role.modal.descriptionLabel'], { ns: 'permission' })}
            </label>
            <Textarea
              id="role-description"
              value={desc}
              onValueChange={onRoleDescChange}
              placeholder={t(($) => $['role.modal.descriptionPlaceholder'], { ns: 'permission' })}
              disabled={readonly}
              className="min-h-24 resize-none"
            />
          </div>
          <PermissionField
            value={permissionKeys}
            onChange={setPermissionKeys}
            readonly={readonly}
          />
        </DialogBody>
        <DialogFooter>
          <a
            href={getEnterpriseDocUrl('/use/workspace/permission-reference', docLanguage)}
            target="_blank"
            rel="noreferrer"
            className="me-auto inline-flex items-center gap-1 system-xs-medium text-text-accent hover:underline"
          >
            <span>{t(($) => $['permissionSet.learnMore'], { ns: 'permission' })}</span>
            <span aria-hidden className="i-ri-external-link-line h-3.5 w-3.5" />
          </a>
          <Button variant="secondary" onClick={onClose}>
            {readonly
              ? t(($) => $['operation.close'], { ns: 'common' })
              : t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          {!readonly && (
            <Button
              variant="primary"
              disabled={!name.trim() || isSubmitting}
              onClick={handleSubmit}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default RoleModal
