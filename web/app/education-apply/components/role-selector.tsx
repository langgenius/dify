import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

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
      key: 'student',
      value: t('education.form.schoolRole.option.student'),
    },
    {
      key: 'teacher',
      value: t('education.form.schoolRole.option.teacher'),
    },
    {
      key: 'school-administrator',
      value: t('education.form.schoolRole.option.administrator'),
    },
  ]

  return (
    <div className='flex'>
      {
        options.map(option => (
          <div
            key={option.key}
            className='flex items-center mr-6 h-5 cursor-pointer'
            onClick={() => onChange(option.key)}
          >
            <div
              className={cn(
                'mr-2 w-4 h-4 bg-components-radio-bg rounded-full border border-components-radio-border shadow-xs system-md-regular text-text-primary',
                option.key === value && 'border-[5px] border-components-radio-border-checked ',
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
