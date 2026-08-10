import type { RefObject } from 'react'
import type { KnowledgeRetrievalV2NodeType } from './types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InputVarType } from '@/app/components/workflow/types'

type Params = {
  id: string
  payload: KnowledgeRetrievalV2NodeType
  runInputData: Record<string, string>
  runInputDataRef: RefObject<Record<string, string>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, string>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}

const useSingleRunFormParams = ({
  payload,
  runInputData,
  runInputDataRef,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const query = runInputData.query
  const setQuery = useCallback(
    (value: string) => setRunInputData({ ...runInputDataRef.current, query: value }),
    [runInputDataRef, setRunInputData],
  )
  const forms = useMemo(
    () => [
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
    ],
    [query, setQuery, t],
  )

  return {
    forms,
    getDependentVars: () => [payload.query_variable_selector],
    getDependentVar: (variable: string) =>
      variable === 'query' ? payload.query_variable_selector : undefined,
  }
}

export default useSingleRunFormParams
