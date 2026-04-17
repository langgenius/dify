import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type RoleSelectorProps = {
  onChange: (value: string) => void
  value: string
}

const RoleSelector = ({
  onChange,
  value,
}: RoleSelectorProps) => {
  const { t } = useTranslation()
  const options = [
    {
      key: 'Student',
      value: t('form.schoolRole.option.student', { ns: 'education' }),
    },
    {
      key: 'Teacher',
      value: t('form.schoolRole.option.teacher', { ns: 'education' }),
    },
    {
      key: 'School-Administrator',
      value: t('form.schoolRole.option.administrator', { ns: 'education' }),
    },
  ]

  return (
    <div className="flex">
      {
        options.map(option => (
          <div
            key={option.key}
            className="mr-6 flex h-5 cursor-pointer items-center system-md-regular text-text-primary"
            onClick={() => onChange(option.key)}
          >
            <div
              className={cn(
                'mr-2 h-4 w-4 rounded-full border border-components-radio-border bg-components-radio-bg shadow-xs',
                option.key === value && 'border-[5px] border-components-radio-border-checked',
              )}
            >
            </div>
            {option.value}
          </div>
        ))
      }
    </div>
  )
}

export default RoleSelector
