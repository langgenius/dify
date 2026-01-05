import type { FC } from 'react'
import type { CodeNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AddButton from '@/app/components/base/button/add-button'
import SyncButton from '@/app/components/base/button/sync-button'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVarList from '@/app/components/workflow/nodes/_base/components/variable/output-var-list'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import RemoveEffectVarConfirm from '../_base/components/remove-effect-var-confirm'
import { extractFunctionParams, extractReturnType } from './code-parser'
import { CodeLanguage } from './types'
import useConfig from './use-config'

const i18nPrefix = 'nodes.code'

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
    handleCodeAndVarsChange,
    handleVarListChange,
    handleAddVariable,
    handleRemoveVariable,
    handleSyncFunctionSignature,
    handleCodeChange,
    handleCodeLanguageChange,
    handleVarsChange,
    handleAddOutputVariable,
    filterVar,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
  } = useConfig(id, data)

  const handleGeneratedCode = (value: string) => {
    const params = extractFunctionParams(value, inputs.code_language)
    const codeNewInput = params.map((p) => {
      return {
        variable: p,
        value_selector: [],
      }
    })
    const returnTypes = extractReturnType(value, inputs.code_language)
    handleCodeAndVarsChange(value, codeNewInput, returnTypes)
  }

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.inputVars`, { ns: 'workflow' })}
          operations={
            !readOnly
              ? (
                  <div className="flex gap-2">
                    <SyncButton popupContent={t(`${i18nPrefix}.syncFunctionSignature`, { ns: 'workflow' })} onClick={handleSyncFunctionSignature} />
                    <AddButton onClick={handleAddVariable} />
                  </div>
                )
              : undefined
          }
        >
          <VarList
            readonly={readOnly}
            nodeId={id}
            list={inputs.variables}
            onChange={handleVarListChange}
            filterVar={filterVar}
            isSupportFileVar={false}
          />
        </Field>
        <Split />
        <CodeEditor
          nodeId={id}
          isInNode
          readOnly={readOnly}
          title={(
            <TypeSelector
              options={codeLanguages}
              value={inputs.code_language}
              onChange={handleCodeLanguageChange}
            />
          )}
          language={inputs.code_language}
          value={inputs.code}
          onChange={handleCodeChange}
          onGenerated={handleGeneratedCode}
          showCodeGenerator={true}
        />
      </div>
      <Split />
      <div className="px-4 pb-2 pt-4">
        <Field
          title={t(`${i18nPrefix}.outputVars`, { ns: 'workflow' })}
          operations={
            <AddButton onClick={handleAddOutputVariable} />
          }
          required
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
      <RemoveEffectVarConfirm
        isShow={isShowRemoveVarConfirm}
        onCancel={hideRemoveVarConfirm}
        onConfirm={onRemoveVarConfirm}
      />
    </div>
  )
}

export default React.memo(Panel)
