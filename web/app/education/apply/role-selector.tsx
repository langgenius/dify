import type { EducationRole } from './types'
import { Field, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Radio, RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useTranslation } from 'react-i18next'

type RoleSelectorProps = {
  onChange: (value: EducationRole) => void
  value: EducationRole
}

const RoleSelector = ({ onChange, value }: RoleSelectorProps) => {
  const { t } = useTranslation()
  const options: { key: EducationRole; value: string }[] = [
    {
      key: 'Student',
      value: t(($) => $['form.schoolRole.option.student'], { ns: 'education' }),
    },
    {
      key: 'Teacher',
      value: t(($) => $['form.schoolRole.option.teacher'], { ns: 'education' }),
    },
    {
      key: 'School-Administrator',
      value: t(($) => $['form.schoolRole.option.administrator'], { ns: 'education' }),
    },
  ]

  return (
    <Field name="role" className="mb-7">
      <Fieldset
        render={
          <RadioGroup<EducationRole> className="gap-6" value={value} onValueChange={onChange} />
        }
      >
        <FieldsetLegend className="flex h-6 items-center py-0 system-md-semibold text-text-secondary">
          {t(($) => $['form.schoolRole.title'], { ns: 'education' })}
        </FieldsetLegend>
        {options.map((option) => (
          <FieldItem key={option.key}>
            <FieldLabel className="flex h-5 cursor-pointer items-center gap-2 py-0 system-md-regular text-text-primary">
              <Radio<EducationRole> value={option.key} />
              {option.value}
            </FieldLabel>
          </FieldItem>
        ))}
      </Fieldset>
    </Field>
  )
}

export default RoleSelector
