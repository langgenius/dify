'use client'
import type { FC } from 'react'
import React, { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import useSWR from 'swr'
import s from './style.module.css'
import Divider from '@/app/components/base/divider'
import { getErrorDocs, retryErrorDocs } from '@/service/datasets'
import type { IndexingStatusResponse } from '@/models/datasets'

const WarningIcon = () =>
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000 /svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M6.40616 0.834307C6.14751 0.719294 5.85222 0.719294 5.59356 0.834307C5.3938 0.923133 5.26403 1.07959 5.17373 1.20708C5.08495 1.33242 4.9899 1.49664 4.88536 1.67723L0.751783 8.81705C0.646828 8.9983 0.551451 9.16302 0.486781 9.3028C0.421056 9.44487 0.349754 9.63584 0.372478 9.85381C0.401884 10.1359 0.549654 10.3922 0.779012 10.5589C0.956259 10.6878 1.15726 10.7218 1.31314 10.7361C1.46651 10.7501 1.65684 10.7501 1.86628 10.7501H10.1334C10.3429 10.7501 10.5332 10.7501 10.6866 10.7361C10.8425 10.7218 11.0435 10.6878 11.2207 10.5589C11.4501 10.3922 11.5978 10.1359 11.6272 9.85381C11.65 9.63584 11.5787 9.44487 11.5129 9.3028C11.4483 9.16303 11.3529 8.99833 11.248 8.81709L7.11436 1.67722C7.00983 1.49663 6.91477 1.33242 6.82599 1.20708C6.73569 1.07959 6.60593 0.923133 6.40616 0.834307ZM6.49988 4.50012C6.49988 4.22398 6.27602 4.00012 5.99988 4.00012C5.72374 4.00012 5.49988 4.22398 5.49988 4.50012V6.50012C5.49988 6.77626 5.72374 7.00012 5.99988 7.00012C6.27602 7.00012 6.49988 6.77626 6.49988 6.50012V4.50012ZM5.99988 8.00012C5.72374 8.00012 5.49988 8.22398 5.49988 8.50012C5.49988 8.77626 5.72374 9.00012 5.99988 9.00012H6.00488C6.28102 9.00012 6.50488 8.77626 6.50488 8.50012C6.50488 8.22398 6.28102 8.00012 6.00488 8.00012H5.99988Z" fill="#F79009" />
  </svg>

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
  const { data: errorDocs } = useSWR({ datasetId }, getErrorDocs)

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

  if (indexState.value === 'success')
    return null

  return (
    <div className={classNames('inline-flex justify-center items-center gap-2', s.retryBtn)}>
      <WarningIcon />
      <span className='flex shrink-0 text-sm text-gray-500'>
        {errorDocs?.total} {t('dataset.docsFailedNotice')}
      </span>
      <Divider type='vertical' className='!h-4' />
      <span
        className={classNames(
          'text-primary-600 font-semibold text-sm cursor-pointer',
          indexState.value === 'retry' && '!text-gray-500 !cursor-not-allowed',
        )}
        onClick={indexState.value === 'error' ? onRetryErrorDocs : undefined}
      >
        {t('dataset.retry')}
      </span>
    </div>
  )
}
export default RetryButton
