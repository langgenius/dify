'use client'
import type { FC } from 'react'
import type { IndexingStatusResponse } from '@/models/datasets'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { retryErrorDocs } from '@/service/datasets'
import { useDatasetErrorDocs } from '@/service/knowledge/use-dataset'
import StatusWithAction from './status-with-action'

type Props = {
  datasetId: string
}
type IIndexState = {
  value: string
}
type ActionType = 'retry' | 'success' | 'error'

type IAction = {
  type: ActionType
}
const indexStateReducer = (state: IIndexState, action: IAction) => {
  const actionMap = {
    retry: 'retry',
    success: 'success',
    error: 'error',
  }

  return {
    ...state,
    value: actionMap[action.type] || state.value,
  }
}

const RetryButton: FC<Props> = ({ datasetId }) => {
  const { t } = useTranslation()
  const [indexState, dispatch] = useReducer(indexStateReducer, { value: 'success' })
  const { data: errorDocs, isLoading, refetch: refetchErrorDocs } = useDatasetErrorDocs(datasetId)

  const onRetryErrorDocs = async () => {
    dispatch({ type: 'retry' })
    const document_ids = errorDocs?.data.map((doc: IndexingStatusResponse) => doc.id) || []
    const res = await retryErrorDocs({ datasetId, document_ids })
    if (res.result === 'success') {
      refetchErrorDocs()
      dispatch({ type: 'success' })
    }
    else {
      dispatch({ type: 'error' })
    }
  }

  useEffect(() => {
    if (errorDocs?.total === 0)
      dispatch({ type: 'success' })
    else
      dispatch({ type: 'error' })
  }, [errorDocs?.total])

  if (isLoading || indexState.value === 'success')
    return null

  return (
    <StatusWithAction
      type="warning"
      description={`${errorDocs?.total} ${t('docsFailedNotice', { ns: 'dataset' })}`}
      actionText={t('retry', { ns: 'dataset' })}
      disabled={indexState.value === 'retry'}
      onAction={indexState.value === 'error' ? onRetryErrorDocs : noop}
    />
  )
}
export default RetryButton
