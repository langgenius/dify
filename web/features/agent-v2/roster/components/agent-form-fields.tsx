import type { Ref } from 'react'
import type { AgentFormValues, AgentIconSelection } from './agent-form'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

type AgentFormFieldsProps = {
  defaultValues: AgentFormValues
  icon: AgentIconSelection
  iconAriaLabel: string
  onIconClick: () => void
  ref: Ref<HTMLInputElement>
}

export function AgentFormFields({
  defaultValues,
  icon,
  iconAriaLabel,
  onIconClick,
  ref,
}: AgentFormFieldsProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-3">
      <div className="flex items-start gap-4">
        <button
          type="button"
          aria-label={iconAriaLabel}
          className="shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
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
        <div className="flex min-w-0 flex-1 flex-col items-start gap-3 pb-1 sm:flex-row">
          <Field
            name="name"
            className="min-w-0 flex-1"
            validate={(value) => {
              if (typeof value === 'string' && value.length > 0 && !value.trim())
                return t(($) => $['roster.createForm.nameRequired'])

              return null
            }}
          >
            <FieldLabel>{t(($) => $['roster.createForm.nameLabel'])}</FieldLabel>
            <Input
              ref={ref}
              autoComplete="off"
              defaultValue={defaultValues.name}
              maxLength={255}
              placeholder={t(($) => $['roster.createForm.namePlaceholder'])}
              required
            />
            <FieldError match="valueMissing">
              {t(($) => $['roster.createForm.nameRequired'])}
            </FieldError>
            <FieldError match="customError" />
          </Field>
          <Field name="role" className="min-w-0 flex-1">
            <FieldLabel>
              {t(($) => $['roster.createForm.roleLabel'])}
              <span className="ml-1 system-xs-regular text-text-tertiary">
                {tCommon(($) => $['label.optional'])}
              </span>
            </FieldLabel>
            <Input
              autoComplete="off"
              defaultValue={defaultValues.role}
              maxLength={255}
              placeholder={t(($) => $['roster.createForm.rolePlaceholder'])}
            />
          </Field>
        </div>
      </div>
      <Field name="description">
        <FieldLabel>
          {t(($) => $['roster.createForm.descriptionLabel'])}
          <span className="ml-1 system-xs-regular text-text-tertiary">
            {tCommon(($) => $['label.optional'])}
          </span>
        </FieldLabel>
        <Textarea
          autoComplete="off"
          className="h-20 resize-none"
          defaultValue={defaultValues.description}
          maxLength={400}
          placeholder={t(($) => $['roster.createForm.descriptionPlaceholder'])}
        />
      </Field>
    </div>
  )
}
