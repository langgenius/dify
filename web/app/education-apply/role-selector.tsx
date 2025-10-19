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
      key: 'Student',
      value: t('education.form.schoolRole.option.student'),
    },
    {
      key: 'Teacher',
      value: t('education.form.schoolRole.option.teacher'),
    },
    {
      key: 'School-Administrator',
      value: t('education.form.schoolRole.option.administrator'),
    },
  ]

  return (
    <div className='flex'>
      {
        options.map(option => (
          <div
            key={option.key}
            className='system-md-regular mr-6 flex h-5 cursor-pointer items-center text-text-primary'
            onClick={() => onChange(option.key)}
          >
            <div
              className={cn(
                'mr-2 h-4 w-4 rounded-full border border-components-radio-border bg-components-radio-bg shadow-xs',
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
