import type { HumanInputSharedNodeType } from '../shared/types'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import { zFormInputConfig, zUserActionConfig } from '@dify/contracts/api/console/apps/zod.gen'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getProcessedHumanInputFormInputs } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { isHumanInputV2NodeData } from '../../human-input-v2/types'
import { selectHumanInputFormPreview } from '../query-select'
import { HumanInputDraftSyncError, syncHumanInputDraft } from '../shared/sync-draft'
import { getHumanInputFormDependencySelectors, isOutput } from '../utils'

const i18nPrefix = 'nodes.humanInput'
const EMPTY_REQUEST_INPUTS: Record<string, string> = {}

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
  const { mutateAsync: submitWorkflowForm } = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.run.post.mutationOptions(),
  )
  const { mutateAsync: submitChatflowForm } = useMutation(
    consoleQuery.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form.run.post.mutationOptions(),
  )
  const { t } = useTranslation(['workflow', 'workflowHumanInput', 'common'])
  const { inputs } = useNodeCrud<HumanInputSharedNodeType>(id, payload)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
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
        if (!item.variable || typeof item.variable !== 'string') return []

        return item.variable.slice(1, -1).split('.')
      })
      .filter((arr) => arr.length > 0)
  }

  const resource = useAtomValue(editorResourceAtom)
  const appId = resource.kind === 'app' ? resource.appId : undefined
  const isWorkflowMode = resource.kind === 'app' && resource.mode === 'workflow'
  const isV2 = isHumanInputV2NodeData(payload)
  const generation = useMutation({
    mutationKey: ['human-input-preview', appId, id],
    mutationFn: async (values: Record<string, string>) => {
      if (!appId) throw new Error('Missing application')
      if (isV2) await syncHumanInputDraft(doSyncWorkflowDraft)
      const requestInputs = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
      )
      const api = isWorkflowMode
        ? consoleClient.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form
        : consoleClient.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form
      const response = await api.preview.post({
        params: { app_id: appId, node_id: id },
        body: { inputs: requestInputs },
      })
      return {
        formData: selectHumanInputFormPreview({
          ...response,
          inputs: response.inputs?.map((input) => zFormInputConfig.parse(input)),
          actions: response.actions?.map((action) => zUserActionConfig.parse(action)),
        }),
        requestInputs,
      }
    },
    onError: (error) => {
      if (error instanceof HumanInputDraftSyncError)
        toast.error(t(($) => $['nodes.humanInputV2.template.testSaveFailed'], { ns: 'workflow' }))
    },
  })
  const { mutate: generate, mutateAsync: generateAsync, reset: resetGeneration } = generation
  useEffect(() => {
    if (payload._isSingleRun === false) resetGeneration()
  }, [payload._isSingleRun, resetGeneration])
  const formData = generation.data?.formData ?? null
  const requiredInputs = generation.data?.requestInputs ?? EMPTY_REQUEST_INPUTS
  const handleFetchFormContent = useCallback(
    async (values: Record<string, string>) => (await generateAsync(values)).formData,
    [generateAsync],
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

  const handleShowGeneratedForm = useCallback(
    (values: Record<string, string>) => {
      if (!appId) return
      generate(values)
    },
    [appId, generate],
  )
  const handleHideGeneratedForm = useCallback(() => {
    resetGeneration()
  }, [resetGeneration])

  return {
    forms,
    isGeneratingForm: generation.isPending,
    getDependentVars,
    showGeneratedForm: generation.isSuccess && Boolean(formData),
    handleShowGeneratedForm,
    handleHideGeneratedForm,
    formData,
    handleFetchFormContent,
    handleSubmitHumanInputForm,
  }
}

export default useSingleRunFormParams
