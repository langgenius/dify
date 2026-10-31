import type { HumanInputSharedNodeType } from '../shared/types'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { zFormInputConfig, zUserActionConfig } from '@dify/contracts/api/console/apps/zod.gen'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getProcessedHumanInputFormInputs } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { isHumanInputV2NodeData } from '../../human-input-v2/types'
import { selectHumanInputFormPreview } from '../query-select'
import { getHumanInputFormDependencySelectors, isOutput } from '../utils'

const i18nPrefix = 'nodes.humanInput'

type Params = {
  id: string
  payload: HumanInputSharedNodeType
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
  const { t } = useTranslation(['workflow', 'workflowHumanInput', 'common'])
  const { inputs } = useNodeCrud<HumanInputSharedNodeType>(id, payload)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const [showGeneratedForm, setShowGeneratedForm] = useState(false)
  const [formData, setFormData] = useState<HumanInputFormData | null>(null)
  const [requiredInputs, setRequiredInputs] = useState<Record<string, string>>({})
  const [isGeneratingForm, setIsGeneratingForm] = useState(false)
  const generationSequenceRef = useRef(0)
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
  const isV2 = isHumanInputV2NodeData(payload)
  const [formSession, setFormSession] = useState({ appId, id, isSingleRun: payload._isSingleRun })
  if (
    formSession.appId !== appId ||
    formSession.id !== id ||
    formSession.isSingleRun !== payload._isSingleRun
  ) {
    setFormSession({ appId, id, isSingleRun: payload._isSingleRun })
    setShowGeneratedForm(false)
    setIsGeneratingForm(false)
    setFormData(null)
    setRequiredInputs({})
  }
  const generationSessionRef = useRef({ appId, id, isSingleRun: payload._isSingleRun })
  const isMountedRef = useRef(false)
  // The child form can generate automatically in its mount effect. Invalidate
  // the previous session before that effect, without cancelling StrictMode replays.
  useLayoutEffect(() => {
    isMountedRef.current = true
    const previous = generationSessionRef.current
    if (
      previous.appId !== appId ||
      previous.id !== id ||
      previous.isSingleRun !== payload._isSingleRun
    ) {
      generationSequenceRef.current += 1
    }
    generationSessionRef.current = { appId, id, isSingleRun: payload._isSingleRun }
    return () => {
      isMountedRef.current = false
    }
  }, [appId, id, payload._isSingleRun])
  const handleFetchFormContent = useCallback(
    async (values: Record<string, string>) => {
      if (!appId) return null
      const generation = ++generationSequenceRef.current
      if (isV2) {
        let saved = false
        let failed = false
        const result = await doSyncWorkflowDraft(true, {
          onSuccess: () => {
            saved = true
          },
          onError: () => {
            failed = true
          },
        })
        if (!isMountedRef.current || generation !== generationSequenceRef.current) return null
        if (failed || (!saved && result == null))
          throw new Error(
            t(($) => $['nodes.humanInputV2.template.testSaveFailed'], { ns: 'workflow' }),
          )
      }
      const requestParamsObj = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
      )
      const previewForm = isWorkflowMode ? previewWorkflowForm : previewChatflowForm
      const response = await previewForm({
        params: { app_id: appId, node_id: id },
        body: { inputs: requestParamsObj },
      })
      if (!isMountedRef.current || generation !== generationSequenceRef.current) return null
      const data = selectHumanInputFormPreview({
        ...response,
        inputs: response.inputs?.map((input) => zFormInputConfig.parse(input)),
        actions: response.actions?.map((action) => zUserActionConfig.parse(action)),
      })
      setFormData(data)
      setRequiredInputs(requestParamsObj)
      return data
    },
    [
      appId,
      id,
      isWorkflowMode,
      previewWorkflowForm,
      previewChatflowForm,
      isV2,
      doSyncWorkflowDraft,
      t,
    ],
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
    if (!appId) return
    const generation = generationSequenceRef.current + 1
    setIsGeneratingForm(true)
    try {
      const form = await handleFetchFormContent(formValue)
      if (form && generation === generationSequenceRef.current) setShowGeneratedForm(true)
    } catch (error) {
      if (!isMountedRef.current || generation !== generationSequenceRef.current) return
      toast.error(error instanceof Error ? error.message : t(($) => $.error, { ns: 'common' }))
    } finally {
      if (isMountedRef.current && generation === generationSequenceRef.current)
        setIsGeneratingForm(false)
    }
  }

  const handleHideGeneratedForm = () => {
    generationSequenceRef.current += 1
    setShowGeneratedForm(false)
    setIsGeneratingForm(false)
  }

  return {
    forms,
    isGeneratingForm,
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
