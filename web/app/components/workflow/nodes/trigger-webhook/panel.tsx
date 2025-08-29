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
import Select from '@/app/components/base/select'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'

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
  const {
    readOnly,
    inputs,
    handleMethodChange,
    handleContentTypeChange,
    handleHeadersChange,
    handleParamsChange,
    handleBodyChange,
    handleAsyncModeChange,
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
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="w-28 shrink-0">
                <Select
                  items={HTTP_METHODS}
                  defaultValue={inputs.method}
                  onSelect={item => handleMethodChange(item.value as HttpMethod)}
                  disabled={readOnly}
                  allowSearch={false}
                />
              </div>
              <div className="flex flex-1 gap-2">
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
          </div>
        </Field>
        <span>{inputs.webhook_debug_url || ''}</span>

        <Split />

        {/* Content Type */}
        <Field title={t(`${i18nPrefix}.contentType`)}>
          <Select
            items={CONTENT_TYPES}
            defaultValue={inputs['content-type']}
            onSelect={item => handleContentTypeChange(item.value as string)}
            disabled={readOnly}
            allowSearch={false}
          />
        </Field>

        <Split />

        {/* Query Parameters */}
        <ParameterTable
          readonly={readOnly}
          title="Query Parameters"
          parameters={inputs.params}
          onChange={handleParamsChange}
          placeholder={t(`${i18nPrefix}.noQueryParameters`)}
          showType={false}
        />

        <Split />

        {/* Header Parameters */}
        <HeaderTable
          readonly={readOnly}
          headers={inputs.headers}
          onChange={handleHeadersChange}
        />

        <Split />

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
              <span className="system-sm-medium text-text-secondary">
                {t(`${i18nPrefix}.asyncMode`)}
              </span>
              <Switch
                defaultValue={inputs.async_mode}
                onChange={handleAsyncModeChange}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="system-sm-medium mb-2 block text-text-secondary">
                {t(`${i18nPrefix}.statusCode`)}
              </label>
              <Input
                type="number"
                value={inputs.status_code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleStatusCodeChange(Number(e.target.value))}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="system-sm-medium mb-2 block text-text-secondary">
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
