import { memo, useEffect, useState } from 'react'

import Form from '../../nodes/_base/components/before-run-form/form'
import { InputVarType } from '../../types'
import ParametersInfo from './parameters-info'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import Button from '@/app/components/base/button'
import { RiLoader2Line } from '@remixicon/react'
import { testApoTools } from '@/service/tools'
import DataDisplay from '../../run/data-display'
const i18nPrefix = 'workflow.singleRun'
const varTypeToInputVarType = (type: string) => {
  if(type === 'string')
    return InputVarType.textInput
  else if (type === 'file')
    return InputVarType.singleFile
  return type
}
const ToolTrialRun = ({ infoSchemas, type, title }) => {
  const [formValues, setFormValues] = useState(null)
  const [formInputs, setFormInputs] = useState([])
  const language = useGetLanguage()
  const { t } = useTranslation()

  const [isRunning, setIsRunning] = useState(false)
  const [displayData, setDisplayData] = useState(null)
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
    setDisplayData(null)
  }, [infoSchemas])
  const handleRun = async () => {
    const data = await testApoTools({
      type,
      title,
      params: formValues,
      startTime: formValues?.startTime,
      endTime: formValues?.endTime,
    })
    if(data?.data?.code)
      setDisplayData({ type: 'error', data: data.data?.message })

    else
      setDisplayData(data)
  }
  return <>
    <div className='py-2 text-text-primary system-sm-semibold-uppercase'>
      {/* {t('tools.setBuiltInTools.parameters')} */}
      数据测试
    </div>
    <Form inputs={formInputs} values={formValues} onChange={newValues => setFormValues(newValues) }
    ></Form>
    <div className='w-full flex pt-2'>
      <Button disabled={isRunning} variant='primary' className='w-0 grow space-x-2' onClick={handleRun}>
        {isRunning && <RiLoader2Line className='animate-spin w-4 h-4 text-white' />}
        <div>{t(`${i18nPrefix}.${isRunning ? 'running' : 'startRun'}`)}</div>
      </Button>
    </div>
    {
      displayData && <DataDisplay dataObj={displayData} />
    }

  </>
}
export default memo(ToolTrialRun)
