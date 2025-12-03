import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import type { KnowledgeRetrievalNodeType } from './types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import { useDatasetsDetailStore } from '../../datasets-detail-store/store'
import type { DataSet } from '@/models/datasets'

const i18nPrefix = 'workflow.nodes.knowledgeRetrieval'

type Params = {
  id: string,
  payload: KnowledgeRetrievalNodeType
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
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
  const datasetsDetail = useDatasetsDetailStore(s => s.datasetsDetail)
  const query = runInputData.query
  const queryAttachment = runInputData.queryAttachment

  const setQuery = useCallback((newQuery: string) => {
    setRunInputData({
      ...runInputData,
      query: newQuery,
    })
  }, [runInputData, setRunInputData])

  const setQueryAttachment = useCallback((newQueryAttachment: string) => {
    setRunInputData({
      ...runInputData,
      queryAttachment: newQueryAttachment,
    })
  }, [runInputData, setRunInputData])

  const forms = useMemo(() => {
    const datasetIds = payload.dataset_ids
    const datasets = datasetIds.reduce<DataSet[]>((acc, id) => {
      if (datasetsDetail[id])
        acc.push(datasetsDetail[id])
      return acc
    }, [])
    const hasMultiModalDatasets = datasets.some(d => d.is_multimodal)
    const inputFields: FormProps[] = [
      {
        inputs: [{
          label: t(`${i18nPrefix}.queryText`)!,
          variable: 'query',
          type: InputVarType.paragraph,
          required: false,
        }],
        values: { query },
        onChange: (keyValue: Record<string, any>) => setQuery(keyValue.query),
      },
    ]
    if (hasMultiModalDatasets) {
      inputFields.push(
        {
          inputs: [{
            label: t(`${i18nPrefix}.queryAttachment`)!,
            variable: 'queryAttachment',
            type: InputVarType.singleFile,
            required: false,
          }],
          values: { queryAttachment },
          onChange: (keyValue: Record<string, any>) => setQueryAttachment(keyValue.queryAttachment),
        },
      )
    }
    return inputFields
  }, [query, setQuery, t, datasetsDetail, payload.dataset_ids, queryAttachment, setQueryAttachment])

  const getDependentVars = () => {
    return [payload.query_variable_selector, payload.query_attachment_selector]
  }
  const getDependentVar = (variable: string) => {
    if (variable === 'query')
      return payload.query_variable_selector
    if (variable === 'queryAttachment')
      return payload.query_attachment_selector
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
