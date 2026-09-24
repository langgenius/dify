import type { FC } from 'react'
import type { HttpNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Switch } from '@langgenius/dify-ui/switch'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ApiInput from './components/api-input'
import AuthorizationModal from './components/authorization'
import CurlPanel from './components/curl-panel'
import EditBody from './components/edit-body'
import KeyValue from './components/key-value'
import Timeout from './components/timeout'
import useConfig from './use-config'

const i18nPrefix = 'nodes.http'

const Panel: FC<NodePanelProps<HttpNodeType>> = ({ id, data }) => {
  const { t } = useTranslation(['workflow', 'workflowIntegrations'])

  const {
    readOnly,
    isDataReady,
    inputs,
    handleMethodChange,
    handleUrlChange,
    headers,
    setHeaders,
    addHeader,
    params,
    setParams,
    addParam,
    setBody,
    isShowAuthorization,
    showAuthorization,
    hideAuthorization,
    setAuthorization,
    setTimeout,
    isShowCurlPanel,
    showCurlPanel,
    hideCurlPanel,
    handleCurlImport,
    handleSSLVerifyChange,
  } = useConfig(id, data)
  // To prevent prompt editor in body not update data.
  if (!isDataReady) return null

  return (
    <div className="pt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(($) => $[`${i18nPrefix}.api`], { ns: 'workflow' })}
          required
          operations={
            <div className="flex">
              <div
                onClick={showAuthorization}
                className={cn(
                  !readOnly && 'cursor-pointer hover:bg-state-base-hover',
                  'flex h-6 items-center space-x-1 rounded-md px-2',
                )}
              >
                {!readOnly && (
                  <span
                    aria-hidden
                    className="i-custom-vender-line-general-settings-01 size-3 text-text-tertiary"
                  />
                )}
                <div className="text-xs font-medium text-text-tertiary">
                  {t(($) => $[`${i18nPrefix}.authorization.authorization`], {
                    ns: 'workflowIntegrations',
                  })}
                  <span className="ml-1 text-text-secondary">
                    {t(($) => $[`${i18nPrefix}.authorization.${inputs.authorization.type}`], {
                      ns: 'workflowIntegrations',
                    })}
                  </span>
                </div>
              </div>
              <div
                onClick={showCurlPanel}
                className={cn(
                  !readOnly && 'cursor-pointer hover:bg-state-base-hover',
                  'flex h-6 items-center space-x-1 rounded-md px-2',
                )}
              >
                {!readOnly && (
                  <span
                    aria-hidden
                    className="i-custom-vender-line-files-file-arrow-01 size-3 text-text-tertiary"
                  />
                )}
                <div className="text-xs font-medium text-text-tertiary">
                  {t(($) => $[`${i18nPrefix}.curl.title`], { ns: 'workflowIntegrations' })}
                </div>
              </div>
            </div>
          }
        >
          <ApiInput
            nodeId={id}
            readonly={readOnly}
            method={inputs.method}
            onMethodChange={handleMethodChange}
            url={inputs.url}
            onUrlChange={handleUrlChange}
          />
        </Field>
        <Field title={t(($) => $[`${i18nPrefix}.headers`], { ns: 'workflowIntegrations' })}>
          <KeyValue
            nodeId={id}
            list={headers}
            onChange={setHeaders}
            onAdd={addHeader}
            readonly={readOnly}
          />
        </Field>
        <Field title={t(($) => $[`${i18nPrefix}.params`], { ns: 'workflowIntegrations' })}>
          <KeyValue
            nodeId={id}
            list={params}
            onChange={setParams}
            onAdd={addParam}
            readonly={readOnly}
          />
        </Field>
        <Field title={t(($) => $[`${i18nPrefix}.body`], { ns: 'workflowIntegrations' })} required>
          <EditBody nodeId={id} readonly={readOnly} payload={inputs.body} onChange={setBody} />
        </Field>
        <Field
          title={t(($) => $[`${i18nPrefix}.verifySSL.title`], { ns: 'workflowIntegrations' })}
          tooltip={t(($) => $[`${i18nPrefix}.verifySSL.warningTooltip`], {
            ns: 'workflowIntegrations',
          })}
          operations={
            <Switch
              checked={!!inputs.ssl_verify}
              onCheckedChange={handleSSLVerifyChange}
              size="md"
              disabled={readOnly}
            />
          }
        ></Field>
      </div>
      <Split />
      <Timeout nodeId={id} readonly={readOnly} payload={inputs.timeout} onChange={setTimeout} />
      {isShowAuthorization && !readOnly && (
        <AuthorizationModal
          nodeId={id}
          isShow
          onHide={hideAuthorization}
          payload={inputs.authorization}
          onChange={setAuthorization}
        />
      )}
      <Split />
      <div className="">
        <OutputVars>
          <>
            <VarItem
              name="body"
              type="string"
              description={t(($) => $[`${i18nPrefix}.outputVars.body`], {
                ns: 'workflowIntegrations',
              })}
            />
            <VarItem
              name="status_code"
              type="number"
              description={t(($) => $[`${i18nPrefix}.outputVars.statusCode`], {
                ns: 'workflowIntegrations',
              })}
            />
            <VarItem
              name="headers"
              type="object"
              description={t(($) => $[`${i18nPrefix}.outputVars.headers`], {
                ns: 'workflowIntegrations',
              })}
            />
            <VarItem
              name="files"
              type="Array[File]"
              description={t(($) => $[`${i18nPrefix}.outputVars.files`], {
                ns: 'workflowIntegrations',
              })}
            />
          </>
        </OutputVars>
      </div>
      {isShowCurlPanel && !readOnly && (
        <CurlPanel nodeId={id} isShow onHide={hideCurlPanel} handleCurlImport={handleCurlImport} />
      )}
    </div>
  )
}

export default memo(Panel)
