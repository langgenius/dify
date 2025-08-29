import type { FC } from 'react'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { HttpMethod, WebhookTriggerNodeType } from './types'
import useConfig from './use-config'
import ParameterTable from './components/parameter-table'
import HeaderTable from './components/header-table'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import type { NodePanelProps } from '@/app/components/workflow/types'
import InputWithCopy from '@/app/components/base/input-with-copy'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import copy from 'copy-to-clipboard'

const i18nPrefix = 'workflow.nodes.triggerWebhook'

const HTTP_METHODS = [
  { name: 'GET', value: 'GET' },
  { name: 'POST', value: 'POST' },
  { name: 'PUT', value: 'PUT' },
  { name: 'DELETE', value: 'DELETE' },
  { name: 'PATCH', value: 'PATCH' },
  { name: 'HEAD', value: 'HEAD' },
]

const CONTENT_TYPES = [
  { name: 'application/json', value: 'application/json' },
  { name: 'application/x-www-form-urlencoded', value: 'application/x-www-form-urlencoded' },
  { name: 'text/plain', value: 'text/plain' },
  { name: 'forms', value: 'forms' },
  { name: 'multipart/form-data', value: 'multipart/form-data' },
]

const Panel: FC<NodePanelProps<WebhookTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const [debugUrlCopied, setDebugUrlCopied] = React.useState(false)
  const {
    readOnly,
    inputs,
    handleMethodChange,
    handleContentTypeChange,
    handleHeadersChange,
    handleParamsChange,
    handleBodyChange,
    handleStatusCodeChange,
    handleResponseBodyChange,
    generateWebhookUrl,
  } = useConfig(id, data)

  // Ensure we only attempt to generate URL once for a newly created node without url
  const hasRequestedUrlRef = useRef(false)
  useEffect(() => {
    if (!readOnly && !inputs.webhook_url && !hasRequestedUrlRef.current) {
      hasRequestedUrlRef.current = true
      void generateWebhookUrl()
    }
  }, [readOnly, inputs.webhook_url, generateWebhookUrl])

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-3 pt-2'>
        {/* Webhook URL Section */}
        <Field title={t(`${i18nPrefix}.webhookUrl`)}>
          <div className="space-y-1">
            <div className="flex gap-1" style={{ height: '32px' }}>
              <div className="w-26 shrink-0">
                <SimpleSelect
                  items={HTTP_METHODS}
                  defaultValue={inputs.method}
                  onSelect={item => handleMethodChange(item.value as HttpMethod)}
                  disabled={readOnly}
                  className="h-8 pr-8 text-sm"
                  wrapperClassName="h-8"
                  optionWrapClassName="w-26 min-w-26 z-[5]"
                  allowSearch={false}
                  notClearable={true}
                />
              </div>
              <div className="flex-1" style={{ width: '284px' }}>
                <InputWithCopy
                  value={inputs.webhook_url || ''}
                  placeholder={t(`${i18nPrefix}.webhookUrlPlaceholder`)}
                  readOnly
                  onCopy={() => {
                    Toast.notify({
                      type: 'success',
                      message: t(`${i18nPrefix}.urlCopied`),
                    })
                  }}
                />
              </div>
            </div>
            {inputs.webhook_debug_url && (
              <Tooltip
                popupContent={debugUrlCopied ? t(`${i18nPrefix}.debugUrlCopied`) : t(`${i18nPrefix}.debugUrlCopy`)}
                popupClassName="system-xs-regular text-text-primary bg-components-tooltip-bg border border-components-panel-border shadow-lg backdrop-blur-sm rounded-md px-1.5 py-1"
                position="top"
                offset={{ mainAxis: -20 }}
                needsDelay={false}
              >
                <div
                  className="flex cursor-pointer gap-1.5 rounded-lg px-1 py-1.5 transition-colors"
                  style={{ width: '368px', height: '38px' }}
                  onClick={() => {
                    copy(inputs.webhook_debug_url || '')
                    setDebugUrlCopied(true)
                    setTimeout(() => setDebugUrlCopied(false), 2000)
                  }}
                >
                  <div className="mt-0.5 w-0.5 bg-divider-regular" style={{ height: '28px' }}></div>
                  <div className="flex-1" style={{ width: '352px', height: '32px' }}>
                    <div className="text-xs leading-4 text-text-tertiary">
                      {t(`${i18nPrefix}.debugUrlTitle`)}
                    </div>
                    <div className="truncate text-xs leading-4 text-text-primary">
                      {inputs.webhook_debug_url}
                    </div>
                  </div>
                </div>
              </Tooltip>
            )}
          </div>
        </Field>

        {/* Content Type */}
        <Field title={t(`${i18nPrefix}.contentType`)}>
          <div className="w-full">
            <SimpleSelect
              items={CONTENT_TYPES}
              defaultValue={inputs['content-type']}
              onSelect={item => handleContentTypeChange(item.value as string)}
              disabled={readOnly}
              className="h-8 text-sm"
              wrapperClassName="h-8"
              optionWrapClassName="min-w-48 z-[5]"
              allowSearch={false}
              notClearable={true}
            />
          </div>
        </Field>

        {/* Query Parameters */}
        <ParameterTable
          readonly={readOnly}
          title="Query Parameters"
          parameters={inputs.params}
          onChange={handleParamsChange}
          placeholder={t(`${i18nPrefix}.noQueryParameters`)}
          showType={false}
        />

        {/* Header Parameters */}
        <HeaderTable
          readonly={readOnly}
          headers={inputs.headers}
          onChange={handleHeadersChange}
        />

        {/* Request Body Parameters */}
        <ParameterTable
          readonly={readOnly}
          title="Request Body Parameters"
          parameters={inputs.body}
          onChange={handleBodyChange}
          placeholder={t(`${i18nPrefix}.noBodyParameters`)}
          showType={true}
          isRequestBody={true}
        />

        <Split />

        {/* Response Configuration */}
        <Field title={t(`${i18nPrefix}.responseConfiguration`)}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="system-sm-medium text-text-tertiary">
                {t(`${i18nPrefix}.statusCode`)}
              </label>
              <Input
                type="number"
                value={inputs.status_code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleStatusCodeChange(Number(e.target.value))}
                disabled={readOnly}
                wrapperClassName="w-[120px]"
                className="h-8"
              />
            </div>
            <div>
              <label className="system-sm-medium mb-2 block text-text-tertiary">
                {t(`${i18nPrefix}.responseBody`)}
              </label>
              <Input
                value={inputs.response_body}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleResponseBodyChange(e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>
        </Field>
      </div>
    </div>
  )
}

export default Panel
