import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Split from '../_base/components/split'
import type { ToolNodeType } from './types'
import useConfig from './use-config'
import InputVarList from './components/input-var-list'
import Button from '@/app/components/base/button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import Loading from '@/app/components/base/loading'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { useToolIcon } from '@/app/components/workflow/hooks'
import { useLogs } from '@/app/components/workflow/run/hooks'
import formatToTracingNodeList from '@/app/components/workflow/run/utils/format-log'

const i18nPrefix = 'workflow.nodes.tool'

const Panel: FC<NodePanelProps<ToolNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    toolInputVarSchema,
    setInputVar,
    handleOnVarOpen,
    filterVar,
    toolSettingSchema,
    toolSettingValue,
    setToolSettingValue,
    currCollection,
    isShowAuthBtn,
    showSetAuth,
    showSetAuthModal,
    hideSetAuthModal,
    handleSaveAuth,
    isLoading,
    isShowSingleRun,
    hideSingleRun,
    singleRunForms,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    outputSchema,
  } = useConfig(id, data)
  const toolIcon = useToolIcon(data)
  const logsParams = useLogs()
  const nodeInfo = useMemo(() => {
    if (!runResult)
      return null
    return formatToTracingNodeList([runResult], t)[0]
  }, [runResult, t])

  if (isLoading) {
    return <div className='flex h-[200px] items-center justify-center'>
      <Loading />
    </div>
  }

  return (
    <div className='pt-2'>
      {!readOnly && isShowAuthBtn && (
        <>
          <div className='px-4'>
            <Button
              variant='primary'
              className='w-full'
              onClick={showSetAuthModal}
            >
              {t(`${i18nPrefix}.toAuthorize`)}
            </Button>
          </div>
        </>
      )}
      {!isShowAuthBtn && <>
        <div className='space-y-4 px-4'>
          {toolInputVarSchema.length > 0 && (
            <Field
              title={t(`${i18nPrefix}.inputVars`)}
            >
              <InputVarList
                readOnly={readOnly}
                nodeId={id}
                schema={toolInputVarSchema as any}
                value={inputs.tool_parameters}
                onChange={setInputVar}
                filterVar={filterVar}
                isSupportConstantValue
                onOpen={handleOnVarOpen}
              />
            </Field>
          )}

          {toolInputVarSchema.length > 0 && toolSettingSchema.length > 0 && (
            <Split />
          )}

          <Form
            className='space-y-4'
            itemClassName='!py-0'
            fieldLabelClassName='!text-[13px] !font-semibold !text-gray-700 uppercase'
            value={toolSettingValue}
            onChange={setToolSettingValue}
            formSchemas={toolSettingSchema as any}
            isEditMode={false}
            showOnVariableMap={{}}
            validating={false}
            inputClassName='!bg-gray-50'
            readonly={readOnly}
          />
        </div>
      </>}

      {showSetAuth && (
        <ConfigCredential
          collection={currCollection!}
          onCancel={hideSetAuthModal}
          onSaved={handleSaveAuth}
          isHideRemoveBtn
        />
      )}

      <div>
        <OutputVars>
          <>
            <VarItem
              name='text'
              type='String'
              description={t(`${i18nPrefix}.outputVars.text`)}
            />
            <VarItem
              name='files'
              type='Array[File]'
              description={t(`${i18nPrefix}.outputVars.files.title`)}
            />
            <VarItem
              name='json'
              type='Array[Object]'
              description={t(`${i18nPrefix}.outputVars.json`)}
            />
            {outputSchema.map(outputItem => (
              <VarItem
                key={outputItem.name}
                name={outputItem.name}
                type={outputItem.type}
                description={outputItem.description}
              />
            ))}
          </>
        </OutputVars>
      </div>

      {isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
          nodeType={inputs.type}
          toolIcon={toolIcon}
          onHide={hideSingleRun}
          forms={singleRunForms}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          {...logsParams}
          result={<ResultPanel {...runResult} showSteps={false} {...logsParams} nodeInfo={nodeInfo} />}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
