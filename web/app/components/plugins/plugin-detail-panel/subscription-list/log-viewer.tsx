'use client'
import type { TriggerLogEntity } from '@/app/components/workflow/block-selector/types'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiFileCopyLine,
} from '@remixicon/react'
import dayjs from 'dayjs'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { cn } from '@/utils/classnames'

type Props = {
  logs: TriggerLogEntity[]
  className?: string
}

enum LogTypeEnum {
  REQUEST = 'request',
  RESPONSE = 'response',
}

const LogViewer = ({ logs, className }: Props) => {
  const { t } = useTranslation()
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())

  const toggleLogExpansion = (logId: string) => {
    const newExpanded = new Set(expandedLogs)
    if (newExpanded.has(logId))
      newExpanded.delete(logId)
    else
      newExpanded.add(logId)

    setExpandedLogs(newExpanded)
  }

  const parseRequestData = (data: any) => {
    if (typeof data === 'string' && data.startsWith('payload=')) {
      try {
        const urlDecoded = decodeURIComponent(data.substring(8)) // Remove 'payload='
        return JSON.parse(urlDecoded)
      }
      catch {
        return data
      }
    }

    if (typeof data === 'object')
      return data

    try {
      return JSON.parse(data)
    }
    catch {
      return data
    }
  }

  const renderJsonContent = (originalData: any, title: LogTypeEnum) => {
    const parsedData = title === LogTypeEnum.REQUEST ? { headers: originalData.headers, data: parseRequestData(originalData.data) } : originalData
    const isJsonObject = typeof parsedData === 'object'

    if (isJsonObject) {
      return (
        <CodeEditor
          readOnly
          title={<div className="system-xs-semibold-uppercase text-text-secondary">{title}</div>}
          language={CodeLanguage.json}
          value={parsedData}
          isJSONStringifyBeauty
          nodeId=""
        />
      )
    }

    return (
      <div className="rounded-md bg-components-input-bg-normal">
        <div className="flex items-center justify-between px-2 py-1">
          <div className="system-xs-semibold-uppercase text-text-secondary">
            {title}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(String(parsedData))
              Toast.notify({
                type: 'success',
                message: t('actionMsg.copySuccessfully', { ns: 'common' }),
              })
            }}
            className="rounded-md p-0.5 hover:bg-components-panel-border"
          >
            <RiFileCopyLine className="h-4 w-4 text-text-tertiary" />
          </button>
        </div>
        <div className="px-2 pb-2 pt-1">
          <pre className="code-xs-regular whitespace-pre-wrap break-all text-text-secondary">
            {String(parsedData)}
          </pre>
        </div>
      </div>
    )
  }

  if (!logs || logs.length === 0)
    return null

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {logs.map((log, index) => {
        const logId = log.id || index.toString()
        const isExpanded = expandedLogs.has(logId)
        const isSuccess = log.response.status_code === 200
        const isError = log.response.status_code >= 400

        return (
          <div
            key={logId}
            className={cn(
              'relative overflow-hidden rounded-lg border bg-components-panel-on-panel-item-bg shadow-sm hover:bg-components-panel-on-panel-item-bg-hover',
              isError && 'border-state-destructive-border',
              !isError && isExpanded && 'border-components-panel-border',
              !isError && !isExpanded && 'border-components-panel-border-subtle',
            )}
          >
            {isError && (
              <div className="pointer-events-none absolute left-0 top-0 h-7 w-[179px]">
                <svg xmlns="http://www.w3.org/2000/svg" width="179" height="28" viewBox="0 0 179 28" fill="none" className="h-full w-full">
                  <g filter="url(#filter0_f_error_glow)">
                    <circle cx="27" cy="14" r="32" fill="#F04438" fillOpacity="0.25" />
                  </g>
                  <defs>
                    <filter id="filter0_f_error_glow" x="-125" y="-138" width="304" height="304" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                      <feFlood floodOpacity="0" result="BackgroundImageFix" />
                      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                      <feGaussianBlur stdDeviation="60" result="effect1_foregroundBlur" />
                    </filter>
                  </defs>
                </svg>
              </div>
            )}

            <button
              onClick={() => toggleLogExpansion(logId)}
              className={cn(
                'flex w-full items-center justify-between px-2 py-1.5 text-left',
                isExpanded ? 'pb-1 pt-2' : 'min-h-7',
              )}
            >
              <div className="flex items-center gap-0">
                {isExpanded
                  ? (
                      <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
                    )
                  : (
                      <RiArrowRightSLine className="h-4 w-4 text-text-tertiary" />
                    )}
                <div className="system-xs-semibold-uppercase text-text-secondary">
                  {t(`modal.manual.logs.${LogTypeEnum.REQUEST}`, { ns: 'pluginTrigger' })}
                  {' '}
                  #
                  {index + 1}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <div className="system-xs-regular text-text-tertiary">
                  {dayjs(log.created_at).format('HH:mm:ss')}
                </div>
                <div className="h-3.5 w-3.5">
                  {isSuccess
                    ? (
                        <RiCheckboxCircleFill className="h-full w-full text-text-success" />
                      )
                    : (
                        <RiErrorWarningFill className="h-full w-full text-text-destructive" />
                      )}
                </div>
              </div>
            </button>

            {isExpanded && (
              <div className="flex flex-col gap-1 px-1 pb-1">
                {renderJsonContent(log.request, LogTypeEnum.REQUEST)}
                {renderJsonContent(log.response, LogTypeEnum.RESPONSE)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default LogViewer
