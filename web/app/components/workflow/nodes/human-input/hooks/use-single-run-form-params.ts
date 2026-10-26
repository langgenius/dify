import type { HumanInputNodeType } from '../types'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getProcessedHumanInputFormInputs } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { consoleQuery } from '@/service/console'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { selectHumanInputFormPreview } from '../query-select'
import { getHumanInputFormDependencySelectors, isOutput } from '../utils'

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
  const { mutateAsync: previewWorkflowForm } = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.preview.post.mutationOptions(),
  )
  const { mutateAsync: previewChatflowForm } = useMutation(
    consoleQuery.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form.preview.post.mutationOptions(),
  )
  const { mutateAsync: submitWorkflowForm } = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.run.post.mutationOptions(),
  )
  const { mutateAsync: submitChatflowForm } = useMutation(
    consoleQuery.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form.run.post.mutationOptions(),
  )
  const { t } = useTranslation(['workflow', 'workflowHumanInput'])
  const { inputs } = useNodeCrud<HumanInputNodeType>(id, payload)
  const [showGeneratedForm, setShowGeneratedForm] = useState(false)
  const [formData, setFormData] = useState<HumanInputFormData | null>(null)
  const [requiredInputs, setRequiredInputs] = useState<Record<string, string>>({})
  const generatedInputs = useMemo(() => {
    const formInputDependencyInputs = getHumanInputFormDependencySelectors(inputs.inputs).map(
      (selector) => `{{#${selector.join('.')}#}}`,
    )
    const allInputs = getInputVars([
      ...formInputDependencyInputs,
      inputs.form_content || '',
    ]).filter((item) => !isOutput(item.value_selector || []))
    return allInputs
  }, [getInputVars, inputs.form_content, inputs.inputs])

  const forms = useMemo(() => {
    const forms: FormProps[] = [
      {
        label: t(($) => $[`${i18nPrefix}.singleRun.label`], { ns: 'workflowHumanInput' })!,
        inputs: generatedInputs,
        values: runInputData,
        onChange: setRunInputData,
      },
    ]
    return forms
  }, [t, generatedInputs, runInputData, setRunInputData])

  const getDependentVars = () => {
    return generatedInputs
      .map((item) => {
        // Guard against null/undefined variable to prevent app crash
        if (!item.variable || typeof item.variable !== 'string') return []

        return item.variable.slice(1, -1).split('.')
      })
      .filter((arr) => arr.length > 0)
  }

  const resource = useAtomValue(editorResourceAtom)
  const appId = resource.kind === 'app' ? resource.appId : undefined
  const isWorkflowMode = resource.kind === 'app' && resource.mode === 'workflow'
  const handleFetchFormContent = useCallback(
    async (inputs: Record<string, string>) => {
      if (!appId) return null
      const requestParamsObj = Object.fromEntries(
        Object.entries(inputs).filter(([, value]) => value !== undefined),
      )
      const previewForm = isWorkflowMode ? previewWorkflowForm : previewChatflowForm
      const response = await previewForm({
        params: { app_id: appId, node_id: id },
        body: { inputs: requestParamsObj },
      })
      const data = selectHumanInputFormPreview(response)
      setFormData(data)
      setRequiredInputs(requestParamsObj)
      return data
    },
    [appId, id, isWorkflowMode, previewWorkflowForm, previewChatflowForm],
  )

  const handleSubmitHumanInputForm = useCallback(
    async (submission: {
      inputs: Record<string, HumanInputFieldValue> | undefined
      form_inputs: Record<string, HumanInputFieldValue> | undefined
      action: string
    }) => {
      if (!appId) return
      const formInputs = formData?.inputs?.length ? formData.inputs : inputs.inputs
      const submitForm = isWorkflowMode ? submitWorkflowForm : submitChatflowForm
      await submitForm({
        params: { app_id: appId, node_id: id },
        body: {
          inputs: requiredInputs,
          form_inputs: getProcessedHumanInputFormInputs(formInputs, submission.inputs) ?? {},
          action: submission.action,
        },
      })
    },
    [
      appId,
      id,
      isWorkflowMode,
      submitWorkflowForm,
      submitChatflowForm,
      formData?.inputs,
      inputs.inputs,
      requiredInputs,
    ],
  )

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
