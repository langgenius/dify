import type { FC } from 'react'
import type { TemplateTransformNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  RiQuestionLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor/editor-support-vars'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import { CodeLanguage } from '../code/types'
import useConfig from './use-config'

const i18nPrefix = 'nodes.templateTransform'

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
  } = useConfig(id, data)

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">

        <Field
          title={t(`${i18nPrefix}.inputVars`, { ns: 'workflow' })}
          operations={
            !readOnly
              ? (
                  <button
                    type="button"
                    aria-label={`${t('operation.add', { ns: 'common' })} ${t(`${i18nPrefix}.inputVars`, { ns: 'workflow' })}`}
                    className="cursor-pointer rounded-md border-none bg-transparent p-1 select-none hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                    onClick={handleAddEmptyVariable}
                  >
                    <span className="i-ri-add-line h-4 w-4 text-text-tertiary" aria-hidden="true" />
                  </button>
                )
              : undefined
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
            <div className="uppercase">{t(`${i18nPrefix}.code`, { ns: 'workflow' })}</div>
          }
          headerRight={(
            <div className="flex items-center">
              <a
                className="flex h-[18px] items-center space-x-0.5 text-xs font-normal text-text-tertiary"
                href="https://jinja.palletsprojects.com/en/3.1.x/templates/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{t(`${i18nPrefix}.codeSupportTip`, { ns: 'workflow' })}</span>
                <RiQuestionLine className="h-3 w-3" />
              </a>
              <div className="mx-1.5 h-3 w-px bg-divider-regular"></div>
            </div>
          )}
          value={inputs.template}
          onChange={handleCodeChange}
        />
      </div>
      <Split />
      <div>
        <OutputVars>
          <>
            <VarItem
              name="output"
              type="string"
              description={t(`${i18nPrefix}.outputVars.output`, { ns: 'workflow' })}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
