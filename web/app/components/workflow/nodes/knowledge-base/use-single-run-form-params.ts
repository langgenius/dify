import { useTranslation } from 'react-i18next'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import type { KnowledgeBaseNodeType } from './types'

type Params = {
  id: string,
  payload: KnowledgeBaseNodeType
  runInputData: Record<string, any>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  payload,
  runInputData,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const query = runInputData.query
  const setQuery = useCallback((newQuery: string) => {
    setRunInputData({
      ...runInputData,
      query: newQuery,
    })
  }, [runInputData, setRunInputData])

  const forms = useMemo(() => {
    return [
      {
        inputs: [{
          label: t('workflow.nodes.common.inputVars'),
          variable: 'query',
          type: InputVarType.paragraph,
          required: true,
        }],
        values: { query },
        onChange: (keyValue: Record<string, any>) => setQuery(keyValue.query),
      },
    ]
  }, [query, setQuery, t])

  const getDependentVars = () => {
    return [payload.index_chunk_variable_selector]
  }
  const getDependentVar = (variable: string) => {
    if(variable === 'query')
      return payload.index_chunk_variable_selector
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
