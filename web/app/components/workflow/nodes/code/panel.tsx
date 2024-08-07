import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import RemoveEffectVarConfirm from '../_base/components/remove-effect-var-confirm'
import useConfig from './use-config'
import type { CodeNodeType } from './types'
import { CodeLanguage } from './types'
import Dependencies from './dependency'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import OutputVarList from '@/app/components/workflow/nodes/_base/components/variable/output-var-list'
import AddButton from '@/app/components/base/button/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import type { NodePanelProps } from '@/app/components/workflow/types'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import ResultPanel from '@/app/components/workflow/run/result-panel'

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

  const {
    readOnly,
    inputs,
    outputKeyOrders,
    handleVarListChange,
    handleAddVariable,
    handleRemoveVariable,
    handleCodeChange,
    handleCodeLanguageChange,
    handleVarsChange,
    handleAddOutputVariable,
    filterVar,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    varInputs,
    inputVarValues,
    setInputVarValues,
    allowDependencies,
    availableDependencies,
    handleAddDependency,
    handleRemoveDependency,
    handleChangeDependency,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputVars`)}
          operations={
            !readOnly ? <AddButton onClick={handleAddVariable} /> : undefined
          }
        >
          <VarList
            readonly={readOnly}
            nodeId={id}
            list={inputs.variables}
            onChange={handleVarListChange}
            filterVar={filterVar}
          />
        </Field>
        {
          allowDependencies
            ? (
              <div>
                <Split />
                <div className='pt-4'>
                  <Field
                    title={t(`${i18nPrefix}.advancedDependencies`)}
                    operations={
                      <AddButton onClick={() => handleAddDependency({ name: '', version: '' })} />
                    }
                    tooltip={t(`${i18nPrefix}.advancedDependenciesTip`)!}
                  >
                    <Dependencies
                      available_dependencies={availableDependencies}
                      dependencies={inputs.dependencies || []}
                      handleRemove={index => handleRemoveDependency(index)}
                      handleChange={(index, dependency) => handleChangeDependency(index, dependency)}
                    />
                  </Field>
                </div>
              </div>
            )
            : null
        }
        <Split />
        <CodeEditor
          isInNode
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
            outputs={inputs.outputs}
            outputKeyOrders={outputKeyOrders}
            onChange={handleVarsChange}
            onRemove={handleRemoveVariable}
          />
        </Field>
      </div>
      {
        isShowSingleRun && (
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
        )
      }
      <RemoveEffectVarConfirm
        isShow={isShowRemoveVarConfirm}
        onCancel={hideRemoveVarConfirm}
        onConfirm={onRemoveVarConfirm}
      />
    </div >
  )
}

export default React.memo(Panel)
