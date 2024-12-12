import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiQuestionLine,
} from '@remixicon/react'
import { CodeLanguage } from '../code/types'
import useConfig from './use-config'
import type { TemplateTransformNodeType } from './types'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import AddButton from '@/app/components/base/button/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor/editor-support-vars'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import type { NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import ResultPanel from '@/app/components/workflow/run/result-panel'

const i18nPrefix = 'workflow.nodes.templateTransform'

const Panel: FC<NodePanelProps<TemplateTransformNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    availableVars,
    handleVarListChange,
    handleVarNameChange,
    handleAddVariable,
    handleAddEmptyVariable,
    handleCodeChange,
    filterVar,
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
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>

        <Field
          title={t(`${i18nPrefix}.inputVars`)}
          operations={
            !readOnly ? <AddButton onClick={handleAddEmptyVariable} /> : undefined
          }
        >
          <VarList
            nodeId={id}
            readonly={readOnly}
            list={inputs.variables}
            onChange={handleVarListChange}
            onVarNameChange={handleVarNameChange}
            filterVar={filterVar}
            isSupportFileVar={false}
          />
        </Field>
        <Split />
        <CodeEditor
          availableVars={availableVars}
          varList={inputs.variables}
          onAddVar={handleAddVariable}
          isInNode
          readOnly={readOnly}
          language={CodeLanguage.python3}
          title={
            <div className='uppercase'>{t(`${i18nPrefix}.code`)}</div>
          }
          headerRight={
            <div className='flex items-center'>
              <a
                className='flex items-center space-x-0.5 h-[18px] text-xs font-normal text-gray-500'
                href="https://jinja.palletsprojects.com/en/3.1.x/templates/"
                target='_blank'>
                <span>{t(`${i18nPrefix}.codeSupportTip`)}</span>
                <RiQuestionLine className='w-3 h-3' />
              </a>
              <div className='mx-1.5 w-px h-3 bg-gray-200'></div>
            </div>
          }
          value={inputs.template}
          onChange={handleCodeChange}
        />
      </div>
      <Split />
      <div>
        <OutputVars>
          <>
            <VarItem
              name='output'
              type='string'
              description={t(`${i18nPrefix}.outputVars.output`)}
            />
          </>
        </OutputVars>
      </div>
      {isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
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
    </div>
  )
}

export default React.memo(Panel)
