import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PermissionLevel } from '@/models/permission'

export type ConnectionDetailsValues = {
  name: string
  visibility: string
  setDefault: boolean
}

type Props = {
  title: string
  accountName?: string
  initialName: string
  initialVisibility: string
  canEdit: boolean
  canSetDefault: boolean
  saveLabel: string
  onSave: (values: ConnectionDetailsValues) => Promise<void>
  onCancel: () => void
  onSavingChange: (saving: boolean) => void
}

// The enclosing dialog keeps this form mounted for one editing/creation session.
export default function ConnectionDetailsForm({
  title,
  accountName,
  initialName,
  initialVisibility,
  canEdit,
  canSetDefault,
  saveLabel,
  onSave,
  onCancel,
  onSavingChange,
}: Props) {
  const { t } = useTranslation(['common', 'plugin', 'datasetSettings'])
  const [name, setName] = useState(initialName)
  const [visibility, setVisibility] = useState(initialVisibility)
  const [setDefault, setSetDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const savingRef = useRef(false)
  const showWorkspaceDefault = visibility !== PermissionLevel.onlyMe
  const shouldSetDefault = showWorkspaceDefault && setDefault
  const nameLabel = t(($) => $['auth.connection.name'], { ns: 'plugin' })
  const requiredNameMessage = t(($) => $['errorMsg.fieldRequired'], {
    ns: 'common',
    field: nameLabel,
  })
  const visibilityLabel =
    visibility === PermissionLevel.onlyMe
      ? t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' })
      : visibility === PermissionLevel.allTeamMembers
        ? t(($) => $['auth.connection.allWorkspaceMembers'], { ns: 'plugin' })
        : visibility === PermissionLevel.partialMembers
          ? t(($) => $['form.permissionsInvitedMembers'], { ns: 'datasetSettings' })
          : t(($) => $['auth.unavailable'], { ns: 'plugin' })
  const scopeOptions = [
    ...(visibility !== PermissionLevel.onlyMe && visibility !== PermissionLevel.allTeamMembers
      ? [{ value: visibility, label: visibilityLabel, icon: 'i-ri-user-community-line' }]
      : []),
    {
      value: PermissionLevel.onlyMe,
      label: t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' }),
      icon: 'i-ri-user-line',
    },
    {
      value: PermissionLevel.allTeamMembers,
      label: t(($) => $['auth.connection.allWorkspaceMembers'], { ns: 'plugin' }),
      icon: 'i-ri-user-community-line',
    },
  ]

  const save = async () => {
    if (!canEdit || savingRef.current || !name.trim()) return
    if (shouldSetDefault && !canSetDefault) return
    savingRef.current = true
    setSaving(true)
    onSavingChange(true)
    setFailed(false)
    let saved = false
    try {
      await onSave({ name: name.trim(), visibility, setDefault: shouldSetDefault })
      saved = true
    } catch {
      setFailed(true)
    } finally {
      savingRef.current = false
      setSaving(false)
      onSavingChange(false)
    }
    if (saved) onCancel()
  }

  return (
    <Form className="contents" onFormSubmit={() => void save()}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {accountName && <DialogDescription>{accountName}</DialogDescription>}
      </DialogHeader>
      <DialogBody className="space-y-5">
        <Field
          name="connectionName"
          className="gap-1.5"
          validationMode="onBlur"
          validate={(value) =>
            typeof value === 'string' && value.trim() ? null : requiredNameMessage
          }
        >
          <FieldLabel className="system-sm-regular text-text-primary">
            {nameLabel}
            <span aria-hidden className="text-text-destructive">
              {' '}
              *
            </span>
          </FieldLabel>
          <Input
            className="h-8"
            value={name}
            onValueChange={setName}
            disabled={!canEdit || saving}
            required
            maxLength={30}
          />
          <FieldError>{requiredNameMessage}</FieldError>
        </Field>
        <Select
          value={visibility}
          onValueChange={(scope) => {
            if (!scope) return
            setVisibility(scope)
            if (scope === PermissionLevel.onlyMe) setSetDefault(false)
          }}
          disabled={saving || !canEdit}
        >
          <div className="flex flex-col gap-2">
            <SelectLabel className="system-md-semibold text-text-primary">
              {t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}
            </SelectLabel>
            <SelectTrigger className="h-10 px-1 system-md-regular">
              <span className="flex items-center gap-0.5">
                <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'size-5 text-text-secondary',
                      visibility === PermissionLevel.onlyMe
                        ? 'i-ri-user-line'
                        : 'i-ri-user-community-line',
                    )}
                  />
                </span>
                <span className="px-1">{visibilityLabel}</span>
              </span>
            </SelectTrigger>
          </div>
          <SelectContent>
            {scopeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span aria-hidden className={cn('size-5 shrink-0', option.icon)} />
                <SelectItemText>{option.label}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showWorkspaceDefault && (
          <Field>
            <FieldLabel className="flex cursor-pointer items-center gap-2 system-sm-regular text-text-primary">
              <Checkbox
                checked={setDefault}
                onCheckedChange={setSetDefault}
                disabled={saving || !canEdit || !canSetDefault}
              />
              {t(($) => $['auth.connection.setWorkspaceDefault'], { ns: 'plugin' })}
            </FieldLabel>
          </Field>
        )}
        {failed && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {t(($) => $['api.actionFailed'], { ns: 'common' })}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button disabled={saving} onClick={onCancel}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canEdit || !name.trim()}
          loading={saving}
        >
          {shouldSetDefault
            ? t(($) => $['auth.connection.saveAsDefault'], { ns: 'plugin' })
            : saveLabel}
        </Button>
      </DialogFooter>
    </Form>
  )
}
