import type { HumanInputSharedNodeType } from '../shared/types'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { zFormInputConfig, zUserActionConfig } from '@dify/contracts/api/web/zod.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { getProcessedHumanInputFormInputs } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { consoleClient } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import { isHumanInputV2NodeData } from '../../human-input-v2/types'
import { normalizeHumanInputFormInput } from '../shared/types'
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
  const { t } = useTranslation()
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
        label: t(($) => $[`${i18nPrefix}.singleRun.label`], { ns: 'workflow' })!,
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

  const appDetail = useAppStore((s) => s.appDetail)
  const appId = appDetail?.id
  const isWorkflowMode = appDetail?.mode === AppModeEnum.WORKFLOW
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
  const api = isWorkflowMode
    ? consoleClient.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form
    : consoleClient.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form

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
      const response = await api.preview.post({
        params: { app_id: appId, node_id: id },
        body: { inputs: requestParamsObj },
      })
      if (!isMountedRef.current || generation !== generationSequenceRef.current) return null
      const data: HumanInputFormData = {
        ...response,
        inputs: (response.inputs ?? []).map((input) =>
          normalizeHumanInputFormInput(zFormInputConfig.parse(input)),
        ),
        actions: (response.actions ?? []).map((action) => {
          const parsed = zUserActionConfig.parse(action)
          return { ...parsed, button_style: parsed.button_style ?? 'default' }
        }),
        form_token: response.form_token ?? null,
        display_in_ui: response.display_in_ui ?? true,
        expiration_time: response.expiration_time ?? null,
        // The preview endpoint documents this legacy field as an opaque mapping.
        // Preserve the server's file/scalar defaults just as the existing renderer expects.
        resolved_default_values: (response.resolved_default_values ??
          {}) as HumanInputFormData['resolved_default_values'],
      }
      setFormData(data)
      setRequiredInputs(requestParamsObj)
      return data
    },
    [api, appId, id, isV2, doSyncWorkflowDraft, t],
  )

  const handleSubmitHumanInputForm = useCallback(
    async (submission: {
      inputs: Record<string, HumanInputFieldValue> | undefined
      form_inputs: Record<string, HumanInputFieldValue> | undefined
      action: string
    }) => {
      const formInputs = formData?.inputs?.length ? formData.inputs : inputs.inputs

      if (!appId) return
      await api.run.post({
        params: { app_id: appId, node_id: id },
        body: {
          inputs: requiredInputs,
          form_inputs: getProcessedHumanInputFormInputs(formInputs, submission.inputs) ?? {},
          action: submission.action,
        },
      })
    },
    [api, appId, id, formData?.inputs, inputs.inputs, requiredInputs],
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
