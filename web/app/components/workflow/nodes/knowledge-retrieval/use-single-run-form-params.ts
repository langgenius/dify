import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'

const i18nPrefix = 'workflow.nodes.knowledgeRetrieval'

type Params = {
  id: string,
  runInputData: Record<string, any>
  runInputDataRef: MutableRefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
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
          label: t(`${i18nPrefix}.queryVariable`)!,
          variable: 'query',
          type: InputVarType.paragraph,
          required: true,
        }],
        values: { query },
        onChange: (keyValue: Record<string, any>) => setQuery(keyValue.query),
      },
    ]
  }, [query, setQuery, t])

  return {
    forms,
  }
}

export default useSingleRunFormParams
