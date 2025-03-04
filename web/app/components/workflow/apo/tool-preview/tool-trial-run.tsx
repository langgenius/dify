import { memo, useEffect, useState } from 'react'

import Form from '../../nodes/_base/components/before-run-form/form'
import { InputVarType } from '../../types'
import ParametersInfo from './parameters-info'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
const varTypeToInputVarType = (type: string) => {
  if(type === 'string')
    return InputVarType.textInput
  else if (type === 'file')
    return InputVarType.singleFile
  return type
}
const ToolTrialRun = ({ infoSchemas }) => {
  const [formValues, setFormValues] = useState(null)
  const [formInputs, setFormInputs] = useState([])
  const language = useGetLanguage()
  const { t } = useTranslation()
  useEffect(() => {
    const formValues = infoSchemas?.reduce((acc, item) => {
      acc[item.name] = null
      return acc
    }, {})
    const formInputs = infoSchemas.map(item => ({
      // label: formLable(item),
      label: item.label[language],
      require: item.require,
      type: varTypeToInputVarType(item.type),
      variable: item.name,
      customLabel: <ParametersInfo parameter={item} />,
    }))
    setFormValues(formValues)
    setFormInputs(formInputs)
  }, [infoSchemas])
  return <>
    <div className='py-2 text-text-primary system-sm-semibold-uppercase'>{t('tools.setBuiltInTools.parameters')}</div>
    <Form inputs={formInputs} values={formValues} onChange={newValues => setFormValues(newValues) }
    ></Form>
  </>
}
export default memo(ToolTrialRun)
