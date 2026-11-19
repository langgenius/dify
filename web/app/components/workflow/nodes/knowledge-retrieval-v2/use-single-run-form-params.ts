import type { RefObject } from 'react'
import type { KnowledgeRetrievalV2NodeType } from './types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar, Var, Variable } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { findVariableWhenOnLLMVision } from '@/app/components/workflow/nodes/utils'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { getKnowledgeRetrievalV2MetadataValueTexts } from './metadata-filtering'

const QUERY_INPUT_KEYS = ['query', 'queryAttachment']

const inputVarToSelector = (inputVar: InputVar) => inputVar.variable.slice(1, -1).split('.')

type Params = {
  id: string
  payload: KnowledgeRetrievalV2NodeType
  runInputData: Record<string, unknown>
  runInputDataRef: RefObject<Record<string, unknown>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, unknown>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}

const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  runInputDataRef,
  getInputVars,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation(['workflow', 'workflowModels'])
  const query = typeof runInputData.query === 'string' ? runInputData.query : ''
  const queryAttachment = runInputData.queryAttachment
  const setQuery = useCallback(
    (value: string) => setRunInputData({ ...runInputDataRef.current, query: value }),
    [runInputDataRef, setRunInputData],
  )
  const setQueryAttachment = useCallback(
    (value: unknown) => setRunInputData({ ...runInputDataRef.current, queryAttachment: value }),
    [runInputDataRef, setRunInputData],
  )
  const filterFileVar = useCallback(
    (variable: Var) => variable.type === VarType.file || variable.type === VarType.arrayFile,
    [],
  )
  const { availableVars: availableFileVars } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterFileVar,
  })
  const metadataVarInputs = getInputVars(getKnowledgeRetrievalV2MetadataValueTexts(payload))
  // Same legacy string-typed Form value contract as the attachment field below.
  const metadataVarValues = Object.fromEntries(
    Object.entries(runInputData).filter(([key]) => !QUERY_INPUT_KEYS.includes(key)),
  ) as Record<string, string>
  const setMetadataVarValues = useCallback(
    (values: Record<string, unknown>) =>
      setRunInputData({
        ...values,
        query: runInputDataRef.current.query,
        queryAttachment: runInputDataRef.current.queryAttachment,
      }),
    [runInputDataRef, setRunInputData],
  )
  const forms = (() => {
    const fields: FormProps[] = [
      {
        inputs: [
          {
            label: t(($) => $['nodes.knowledgeRetrievalV2.queryText'], { ns: 'workflow' }),
            variable: 'query',
            type: InputVarType.paragraph,
            required: false,
          },
        ],
        values: { query },
        onChange: (values: Record<string, string>) => setQuery(values.query ?? ''),
      },
    ]
    if (payload.query_attachment_selector?.length) {
      const currentVariable = findVariableWhenOnLLMVision(
        payload.query_attachment_selector,
        availableFileVars,
      )
      fields.push({
        inputs: [
          {
            label: t(($) => $['nodes.knowledgeRetrieval.queryAttachment'], {
              ns: 'workflowModels',
            })!,
            variable: 'queryAttachment',
            type: currentVariable?.formType as InputVarType,
            required: false,
          },
        ],
        // Before-run Form's legacy value contract is typed as strings even though file controls
        // carry file ids/arrays at runtime. Preserve the value without widening this hook to any.
        values: { queryAttachment: queryAttachment as string },
        onChange: (values: Record<string, unknown>) => setQueryAttachment(values.queryAttachment),
      })
    }
    if (metadataVarInputs.length > 0) {
      fields.push({
        label: t(($) => $['nodes.llm.singleRun.variable'], { ns: 'workflowModels' })!,
        inputs: metadataVarInputs,
        values: metadataVarValues,
        onChange: setMetadataVarValues,
      })
    }
    return fields
  })()

  return {
    forms,
    getDependentVars: () => [
      payload.query_variable_selector,
      payload.query_attachment_selector ?? [],
      ...metadataVarInputs.map(inputVarToSelector),
    ],
    getDependentVar: (variable: string) => {
      if (variable === 'query') return payload.query_variable_selector
      if (variable === 'queryAttachment') return payload.query_attachment_selector ?? []
    },
  }
}

export default useSingleRunFormParams
