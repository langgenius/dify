import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import ApiInput from './components/api-input'
import KeyValue from './components/key-value'
import EditBody from './components/edit-body'
import AuthorizationModal from './components/authorization'
import type { HttpNodeType } from './types'
import Timeout from './components/timeout'
import CurlPanel from './components/curl-panel'
import cn from '@/utils/classnames'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import { FileArrow01 } from '@/app/components/base/icons/src/vender/line/files'
import type { NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import ResultPanel from '@/app/components/workflow/run/result-panel'

const i18nPrefix = 'workflow.nodes.http'

const Panel: FC<NodePanelProps<HttpNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

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
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    varInputs,
    inputVarValues,
    setInputVarValues,
    runResult,
    isShowCurlPanel,
    showCurlPanel,
    hideCurlPanel,
    handleCurlImport,
  } = useConfig(id, data)
  // To prevent prompt editor in body not update data.
  if (!isDataReady)
    return null

  return (
    <div className='pt-2'>
      <div className='space-y-4 px-4 pb-4'>
        <Field
          title={t(`${i18nPrefix}.api`)}
          operations={
            <div className='flex'>
              <div
                onClick={showAuthorization}
                className={cn(!readOnly && 'cursor-pointer hover:bg-gray-50', 'flex h-6 items-center space-x-1 rounded-md px-2 ')}
              >
                {!readOnly && <Settings01 className='h-3 w-3 text-gray-500' />}
                <div className='text-xs font-medium text-gray-500'>
                  {t(`${i18nPrefix}.authorization.authorization`)}
                  <span className='ml-1 text-gray-700'>{t(`${i18nPrefix}.authorization.${inputs.authorization.type}`)}</span>
                </div>
              </div>
              <div
                onClick={showCurlPanel}
                className={cn(!readOnly && 'cursor-pointer hover:bg-gray-50', 'flex h-6 items-center space-x-1 rounded-md px-2 ')}
              >
                {!readOnly && <FileArrow01 className='h-3 w-3 text-gray-500' />}
                <div className='text-xs font-medium text-gray-500'>
                  {t(`${i18nPrefix}.curl.title`)}
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
        <Field
          title={t(`${i18nPrefix}.headers`)}
        >
          <KeyValue
            nodeId={id}
            list={headers}
            onChange={setHeaders}
            onAdd={addHeader}
            readonly={readOnly}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.params`)}
        >
          <KeyValue
            nodeId={id}
            list={params}
            onChange={setParams}
            onAdd={addParam}
            readonly={readOnly}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.body`)}
        >
          <EditBody
            nodeId={id}
            readonly={readOnly}
            payload={inputs.body}
            onChange={setBody}
          />
        </Field>
      </div>
      <Split />
      <Timeout
        nodeId={id}
        readonly={readOnly}
        payload={inputs.timeout}
        onChange={setTimeout}
      />
      {(isShowAuthorization && !readOnly) && (
        <AuthorizationModal
          nodeId={id}
          isShow
          onHide={hideAuthorization}
          payload={inputs.authorization}
          onChange={setAuthorization}
        />
      )}
      <Split />
      <div className=''>
        <OutputVars>
          <>
            <VarItem
              name='body'
              type='string'
              description={t(`${i18nPrefix}.outputVars.body`)}
            />
            <VarItem
              name='status_code'
              type='number'
              description={t(`${i18nPrefix}.outputVars.statusCode`)}
            />
            <VarItem
              name='headers'
              type='object'
              description={t(`${i18nPrefix}.outputVars.headers`)}
            />
            <VarItem
              name='files'
              type='Array[File]'
              description={t(`${i18nPrefix}.outputVars.files`)}
            />
          </>
        </OutputVars>
      </div>
      {isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
          nodeType={inputs.type}
          onHide={hideSingleRun}
          forms={[
            {
              inputs: varInputs,
              values: inputVarValues,
              onChange: setInputVarValues,
            },
          ]}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          result={<ResultPanel {...runResult} showSteps={false} />}
        />
      )}
      {(isShowCurlPanel && !readOnly) && (
        <CurlPanel
          nodeId={id}
          isShow
          onHide={hideCurlPanel}
          handleCurlImport={handleCurlImport}
        />
      )}
    </div>
  )
}

export default memo(Panel)
