import { useGetLanguage } from '@/context/i18n'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
const ParametersInfo = ({ parameter }) => {
  const language = useGetLanguage()
  const { t } = useTranslation()
  const getType = (type: string) => {
    if (type === 'number-input')
      return t('tools.setBuiltInTools.number')
    if (type === 'text-input')
      return t('tools.setBuiltInTools.string')
    if (type === 'file')
      return t('tools.setBuiltInTools.file')
    return type
  }
  return <div>
    <div className='flex items-center gap-2'>
      <div className='text-text-secondary code-sm-semibold'>{parameter.label[language]}</div>
      <div className='text-text-tertiary system-xs-regular'>
        {getType(parameter.type)}
      </div>
      {parameter.required && (
        <div className='text-text-warning-secondary system-xs-medium'>{t('tools.setBuiltInTools.required')}</div>
      )}
    </div>
    {parameter.human_description && (
      <div className='mt-0.5 text-text-tertiary system-xs-regular'>
        {parameter.human_description?.[language]}
      </div>
    )}
  </div>
}
export default memo(ParametersInfo)
