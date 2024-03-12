import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { CodeNodeType } from './types'
import { CodeLanguage } from './types'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import OutputVarList from '@/app/components/workflow/nodes/_base/components/variable/output-var-list'
import AddButton from '@/app/components/base/button/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import type { NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'

const i18nPrefix = 'workflow.nodes.code'

const codeLanguages = [
  {
    label: 'Python3',
    value: CodeLanguage.python3,
  },
  {
    label: 'JavaScript',
    value: CodeLanguage.javascript,
  },
]
const Panel: FC<NodePanelProps<CodeNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleCodeChange,
    handleCodeLanguageChange,
    handleOutputVarListChange,
    handleAddOutputVariable,
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    varInputs,
    inputVarValues,
    setInputVarValues,
  } = useConfig(id, data)
  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputVars`)}
          operations={
            <AddButton onClick={handleAddVariable} />
          }
        >
          <VarList
            readonly={readOnly}
            list={inputs.variables}
            onChange={handleVarListChange}
          />
        </Field>
        <Split />
        <CodeEditor
          readOnly={readOnly}
          title={
            <TypeSelector
              options={codeLanguages}
              value={inputs.code_language}
              onChange={handleCodeLanguageChange}
            />
          }
          language={inputs.code_language}
          value={inputs.code}
          onChange={handleCodeChange}
        />
      </div>
      <Split />
      <div className='px-4 pt-4 pb-2'>
        <Field
          title={t(`${i18nPrefix}.outputVars`)}
          operations={
            <AddButton onClick={handleAddOutputVariable} />
          }
        >
          <OutputVarList
            readonly={readOnly}
            list={inputs.outputs}
            onChange={handleOutputVarListChange}
          />
        </Field>
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
        />
      )}

    </div>
  )
}

export default React.memo(Panel)
