import type { AgentIconSelection } from './agent-form'
import { Field, FieldControl, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

type AgentFormFieldsProps = {
  description: string
  icon: AgentIconSelection
  iconAriaLabel: string
  name: string
  onDescriptionChange: (description: string) => void
  onIconClick: () => void
  onNameChange: (name: string) => void
  onRoleChange: (role: string) => void
  role: string
}

export function AgentFormFields({
  description,
  icon,
  iconAriaLabel,
  name,
  onDescriptionChange,
  onIconClick,
  onNameChange,
  onRoleChange,
  role,
}: AgentFormFieldsProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')

  return (
    <div className="space-y-5 px-6 py-3">
      <div className="flex items-end gap-4 pb-2">
        <button
          type="button"
          aria-label={iconAriaLabel}
          className="shrink-0 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={onIconClick}
        >
          <AppIcon
            size="xxl"
            rounded
            className="size-16 cursor-pointer"
            iconType={icon.type === 'link' ? 'image' : icon.type}
            icon={icon.type === 'emoji' ? icon.icon : undefined}
            background={icon.type === 'emoji' ? icon.background : undefined}
            imageUrl={icon.type === 'emoji' ? undefined : icon.url}
          />
        </button>
        <div className="flex min-w-0 flex-1 gap-3 pb-1">
          <Field
            name="name"
            className="relative min-w-0 flex-1"
            validate={(value) => {
              if (typeof value === 'string' && value.length > 0 && !value.trim())
                return t($ => $['roster.createForm.nameRequired'])

              return null
            }}
          >
            <FieldLabel>
              {t($ => $['roster.createForm.nameLabel'])}
            </FieldLabel>
            <FieldControl
              autoComplete="off"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- Agent roster dialogs open from explicit commands, and the name field is the primary editable control.
              autoFocus
              maxLength={255}
              onValueChange={onNameChange}
              placeholder={t($ => $['roster.createForm.namePlaceholder'])}
              required
              value={name}
            />
            <div className="absolute top-full left-0 mt-1">
              <FieldError match="valueMissing">{t($ => $['roster.createForm.nameRequired'])}</FieldError>
              <FieldError match="customError" />
            </div>
          </Field>
          <Field
            name="role"
            className="relative min-w-0 flex-1"
          >
            <FieldLabel>
              {t($ => $['roster.createForm.roleLabel'])}
              <span className="ml-1 system-xs-regular text-text-tertiary">
                {tCommon($ => $['label.optional'])}
              </span>
            </FieldLabel>
            <FieldControl
              autoComplete="off"
              maxLength={255}
              onValueChange={onRoleChange}
              placeholder={t($ => $['roster.createForm.rolePlaceholder'])}
              value={role}
            />
          </Field>
        </div>
      </div>
      <Field name="description">
        <FieldLabel>
          {t($ => $['roster.createForm.descriptionLabel'])}
          <span className="ml-1 system-xs-regular text-text-tertiary">
            {tCommon($ => $['label.optional'])}
          </span>
        </FieldLabel>
        <Textarea
          autoComplete="off"
          className="h-20 resize-none"
          onValueChange={onDescriptionChange}
          placeholder={t($ => $['roster.createForm.descriptionPlaceholder'])}
          value={description}
        />
      </Field>
    </div>
  )
}
