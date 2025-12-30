import type { RefObject } from 'react'
import type { KnowledgeRetrievalNodeType } from './types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar, Var, Variable } from '@/app/components/workflow/types'
import type { DataSet } from '@/models/datasets'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { useDatasetsDetailStore } from '../../datasets-detail-store/store'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import { findVariableWhenOnLLMVision } from '../utils'

const i18nPrefix = 'nodes.knowledgeRetrieval'

type Params = {
  id: string
  payload: KnowledgeRetrievalNodeType
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  runInputDataRef,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const datasetsDetail = useDatasetsDetailStore(s => s.datasetsDetail)
  const query = runInputData.query
  const queryAttachment = runInputData.queryAttachment

  const setQuery = useCallback((newQuery: string) => {
    setRunInputData({
      ...runInputDataRef.current,
      query: newQuery,
    })
  }, [runInputDataRef, setRunInputData])

  const setQueryAttachment = useCallback((newQueryAttachment: string) => {
    setRunInputData({
      ...runInputDataRef.current,
      queryAttachment: newQueryAttachment,
    })
  }, [runInputDataRef, setRunInputData])

  const filterFileVar = useCallback((varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])

  // Get all variables from previous nodes that are file or array of file
  const {
    availableVars: availableFileVars,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterFileVar,
  })

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
          label: t(`${i18nPrefix}.queryText`, { ns: 'workflow' })!,
          variable: 'query',
          type: InputVarType.paragraph,
          required: false,
        }],
        values: { query },
        onChange: (keyValue: Record<string, any>) => setQuery(keyValue.query),
      },
    ]
    if (hasMultiModalDatasets) {
      const currentVariable = findVariableWhenOnLLMVision(payload.query_attachment_selector || [], availableFileVars)
      inputFields.push(
        {
          inputs: [{
            label: t(`${i18nPrefix}.queryAttachment`, { ns: 'workflow' })!,
            variable: 'queryAttachment',
            type: currentVariable?.formType as InputVarType,
            required: false,
          }],
          values: { queryAttachment },
          onChange: (keyValue: Record<string, any>) => setQueryAttachment(keyValue.queryAttachment),
        },
      )
    }
    return inputFields
  }, [query, setQuery, t, datasetsDetail, payload.dataset_ids, payload.query_attachment_selector, availableFileVars, queryAttachment, setQueryAttachment])

  const getDependentVars = () => {
    return [payload.query_variable_selector, payload.query_attachment_selector || []]
  }
  const getDependentVar = (variable: string) => {
    if (variable === 'query')
      return payload.query_variable_selector
    if (variable === 'queryAttachment')
      return payload.query_attachment_selector || []
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
