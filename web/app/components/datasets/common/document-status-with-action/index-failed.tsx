'use client'
import type { FC } from 'react'
import React, { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import StatusWithAction from './status-with-action'
import { getErrorDocs, retryErrorDocs } from '@/service/datasets'
import type { IndexingStatusResponse } from '@/models/datasets'
import { noop } from 'lodash-es'

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
  const { data: errorDocs, isLoading } = useSWR({ datasetId }, getErrorDocs)

  const onRetryErrorDocs = async () => {
    dispatch({ type: 'retry' })
    const document_ids = errorDocs?.data.map((doc: IndexingStatusResponse) => doc.id) || []
    const res = await retryErrorDocs({ datasetId, document_ids })
    if (res.result === 'success')
      dispatch({ type: 'success' })
    else
      dispatch({ type: 'error' })
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
      type='warning'
      description={`${errorDocs?.total} ${t('dataset.docsFailedNotice')}`}
      actionText={t('dataset.retry')}
      disabled={indexState.value === 'retry'}
      onAction={indexState.value === 'error' ? onRetryErrorDocs : noop}
    />
  )
}
export default RetryButton
