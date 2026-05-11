import type { HumanInputNodeType } from '../types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
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
  runInputData: Record<string, string>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, string>) => void
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
  const [formData, setFormData] = useState<HumanInputFormData | null>(null)
  const [requiredInputs, setRequiredInputs] = useState<Record<string, string>>({})
  const generatedInputs = useMemo(() => {
    const defaultInputs = inputs.inputs.reduce((acc, input) => {
      if (input.default.type === 'variable') {
        acc.push(`{{#${input.default.selector.join('.')}#}}`)
      }
      return acc
    }, [] as string[])
    const allInputs = getInputVars([...defaultInputs, inputs.form_content || '']).filter(item => !isOutput(item.value_selector || []))
    return allInputs
  }, [getInputVars, inputs.form_content, inputs.inputs])

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

  const handleFetchFormContent = useCallback(async (inputs: Record<string, string>) => {
    if (!fetchURL)
      return null
    let requestParamsObj: Record<string, string> = {}
    Object.keys(inputs).forEach((key) => {
      if (inputs[key] === undefined) {
        delete inputs[key]
      }
    })
    requestParamsObj = { ...inputs }
    const data = await fetchHumanInputNodeStepRunForm(fetchURL, { inputs: requestParamsObj! })
    setFormData(data)
    setRequiredInputs(requestParamsObj)
    return data
  }, [fetchURL])

  const handleSubmitHumanInputForm = useCallback(async (formData: {
    inputs: Record<string, string> | undefined
    form_inputs: Record<string, string> | undefined
    action: string
  }) => {
    await submitHumanInputNodeStepRunForm(fetchURL, {
      inputs: requiredInputs,
      form_inputs: formData.inputs,
      action: formData.action,
    })
  }, [fetchURL, requiredInputs])

  const handleShowGeneratedForm = async (formValue: Record<string, string>) => {
    setShowGeneratedForm(true)
    await handleFetchFormContent(formValue)
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
