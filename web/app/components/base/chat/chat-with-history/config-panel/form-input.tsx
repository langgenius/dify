import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { memo } from 'react'

type InputProps = {
  form: any
  value: string
  onChange: (variable: string, value: string) => void
}
const FormInput: FC<InputProps> = ({
  form,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const {
    type,
    label,
    required,
    max_length,
    variable,
  } = form

  if (type === 'paragraph') {
    return (
      <textarea
        value={value}
        className='grow h-[104px] rounded-lg bg-gray-100 px-2.5 py-2 outline-none appearance-none resize-none'
        onChange={e => onChange(variable, e.target.value)}
        placeholder={`${label}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
      />
    )
  }

  return (
    <input
      className='grow h-9 rounded-lg bg-gray-100 px-2.5 outline-none appearance-none'
      value={value || ''}
      maxLength={max_length}
      onChange={e => onChange(variable, e.target.value)}
      placeholder={`${label}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
    />
  )
}

export default memo(FormInput)
