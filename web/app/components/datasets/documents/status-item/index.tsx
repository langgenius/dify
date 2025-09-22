import React, { useMemo } from 'react'
import type { ColorMap, IndicatorProps } from '@/app/components/header/indicator'
import Indicator from '@/app/components/header/indicator'
import type { DocumentDisplayStatus } from '@/models/datasets'
import { useContext } from 'use-context-selector'
import { useIndexStatus } from './hooks'
import { ToastContext } from '@/app/components/base/toast'
import { useTranslation } from 'react-i18next'
import { useDocumentDelete, useDocumentDisable, useDocumentEnable } from '@/service/knowledge/use-document'
import type { CommonResponse } from '@/models/common'
import { asyncRunSafe } from '@/utils'
import { useDebounceFn } from 'ahooks'
import s from '../style.module.css'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import type { OperationName } from '../types'

const STATUS_TEXT_COLOR_MAP: ColorMap = {
  green: 'text-util-colors-green-green-600',
  orange: 'text-util-colors-warning-warning-600',
  red: 'text-util-colors-red-red-600',
  blue: 'text-util-colors-blue-light-blue-light-600',
  yellow: 'text-util-colors-warning-warning-600',
  gray: 'text-text-tertiary',
}

type StatusItemProps = {
  status: DocumentDisplayStatus
  reverse?: boolean
  scene?: 'list' | 'detail'
  textCls?: string
  errorMessage?: string
  detail?: {
    enabled: boolean
    archived: boolean
    id: string
  }
  datasetId?: string
  onUpdate?: (operationName?: string) => void
}

const StatusItem = ({
  status,
  reverse = false,
  scene = 'list',
  textCls = '',
  errorMessage,
  datasetId = '',
  detail,
  onUpdate,
}: StatusItemProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const DOC_INDEX_STATUS_MAP = useIndexStatus()
  const localStatus = status.toLowerCase() as keyof typeof DOC_INDEX_STATUS_MAP
  const { enabled = false, archived = false, id = '' } = detail || {}
  const { mutateAsync: enableDocument } = useDocumentEnable()
  const { mutateAsync: disableDocument } = useDocumentDisable()
  const { mutateAsync: deleteDocument } = useDocumentDelete()

  const onOperate = async (operationName: OperationName) => {
    let opApi = deleteDocument
    switch (operationName) {
      case 'enable':
        opApi = enableDocument
        break
      case 'disable':
        opApi = disableDocument
        break
    }
    const [e] = await asyncRunSafe<CommonResponse>(opApi({ datasetId, documentId: id }) as Promise<CommonResponse>)
    if (!e) {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onUpdate?.(operationName)
    }
    else { notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') }) }
  }

  const { run: handleSwitch } = useDebounceFn((operationName: OperationName) => {
    if (operationName === 'enable' && enabled)
      return
    if (operationName === 'disable' && !enabled)
      return
    onOperate(operationName)
  }, { wait: 500 })

  const embedding = useMemo(() => {
    return ['queuing', 'indexing', 'paused'].includes(localStatus)
  }, [localStatus])

  return <div className={
    cn('flex items-center',
      reverse ? 'flex-row-reverse' : '',
      scene === 'detail' ? s.statusItemDetail : '')
  }>
    <Indicator color={DOC_INDEX_STATUS_MAP[localStatus]?.color as IndicatorProps['color']} className={reverse ? 'ml-2' : 'mr-2'} />
    <span className={cn(`${STATUS_TEXT_COLOR_MAP[DOC_INDEX_STATUS_MAP[localStatus].color as keyof typeof STATUS_TEXT_COLOR_MAP]} text-sm`, textCls)}>
      {DOC_INDEX_STATUS_MAP[localStatus]?.text}
    </span>
    {
      errorMessage && (
        <Tooltip
          popupContent={
            <div className='max-w-[260px] break-all'>{errorMessage}</div>
          }
          triggerClassName='ml-1 w-4 h-4'
        />
      )
    }
    {
      scene === 'detail' && (
        <div className='ml-1.5 flex items-center justify-between'>
          <Tooltip
            popupContent={t('datasetDocuments.list.action.enableWarning')}
            popupClassName='text-text-secondary system-xs-medium'
            disabled={!archived}
          >
            <Switch
              defaultValue={archived ? false : enabled}
              onChange={v => !archived && handleSwitch(v ? 'enable' : 'disable')}
              disabled={embedding || archived}
              size='md'
            />
          </Tooltip>
        </div>
      )
    }
  </div>
}

export default React.memo(StatusItem)
