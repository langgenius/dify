import type { HumanInputNodeType } from '../types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchHumanInputNodeStepRunForm, submitHumanInputNodeStepRunForm } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { isOutput } from '../utils'

const i18nPrefix = 'nodes.humanInput'

type Params = {
  id: string
  payload: HumanInputNodeType
  runInputData: Record<string, any>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  getInputVars,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const { inputs } = useNodeCrud<HumanInputNodeType>(id, payload)
  const [showGeneratedForm, setShowGeneratedForm] = useState(false)
  const [formData, setFormData] = useState<any>(null)
  const generatedInputs = useMemo(() => {
    if (!inputs.form_content)
      return []
    return getInputVars([inputs.form_content]).filter(item => !isOutput(item.value_selector || []))
  }, [getInputVars, inputs.form_content])

  const forms = useMemo(() => {
    const forms: FormProps[] = [{
      label: t(`${i18nPrefix}.singleRun.label`, { ns: 'workflow' })!,
      inputs: generatedInputs,
      values: runInputData,
      onChange: setRunInputData,
    }]
    return forms
  }, [t, generatedInputs, runInputData, setRunInputData])

  const getDependentVars = () => {
    return generatedInputs.map((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return []

      return item.variable.slice(1, -1).split('.')
    }).filter(arr => arr.length > 0)
  }

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id
  const isWorkflowMode = appDetail?.mode === AppModeEnum.WORKFLOW
  const fetchURL = useMemo(() => {
    if (!appId)
      return ''
    if (!isWorkflowMode) {
      return `/apps/${appId}/advanced-chat/workflows/draft/human-input/nodes/${id}/form`
    }
    else {
      return `/apps/${appId}/workflows/draft/human-input/nodes/${id}/form`
    }
  }, [appId, id, isWorkflowMode])

  const handleFetchFormContent = useCallback(async (inputs: Record<string, any>) => {
    if (!fetchURL)
      return null
    let requestParamsObj
    Object.keys(inputs).forEach((key) => {
      if (inputs[key] === undefined) {
        delete inputs[key]
      }
    })
    requestParamsObj = { ...inputs }
    if (Object.keys(requestParamsObj).length === 0) {
      requestParamsObj = undefined
    }
    const data = await fetchHumanInputNodeStepRunForm(fetchURL, { inputs: requestParamsObj! })
    setFormData(data)
    return data
  }, [fetchURL])

  const handleSubmitHumanInputForm = useCallback(async (formData: any) => {
    await submitHumanInputNodeStepRunForm(fetchURL, formData)
  }, [fetchURL])

  const handleShowGeneratedForm = async (formValue: Record<string, any>) => {
    await handleFetchFormContent(formValue)
    setShowGeneratedForm(true)
  }

  const handleHideGeneratedForm = () => {
    setShowGeneratedForm(false)
  }

  return {
    forms,
    getDependentVars,
    showGeneratedForm,
    handleShowGeneratedForm,
    handleHideGeneratedForm,
    formData,
    handleFetchFormContent,
    handleSubmitHumanInputForm,
  }
}

export default useSingleRunFormParams
