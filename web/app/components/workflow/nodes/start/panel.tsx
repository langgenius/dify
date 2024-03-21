import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarList from './components/var-list'
import useConfig from './use-config'
import type { StartNodeType } from './types'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import AddButton from '@/app/components/base/button/add-button'
import ConfigVarModal from '@/app/components/workflow/types'
import type { InputVar, NodePanelProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.start'

const Panel: FC<NodePanelProps<StartNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    readOnly,
    isChatMode,
    inputs,
    isShowAddVarModal,
    showAddVarModal,
    handleAddVariable,
    hideAddVarModal,
    handleVarListChange,
  } = useConfig(id, data)

  const handleAddVarConfirm = (payload: InputVar) => {
    handleAddVariable(payload)
    hideAddVarModal()
  }

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputField`)}
          operations={
            !readOnly ? <AddButton onClick={showAddVarModal} /> : undefined
          }
        >
          <VarList
            readonly={readOnly}
            list={inputs.variables || []}
            onChange={handleVarListChange}
          />
        </Field>
      </div>
      {isChatMode && <Split />}
      {isChatMode && (
        <div className='px-4 pt-4 pb-2'>
          <OutputVars title={t(`${i18nPrefix}.builtInVar`)!}>
            <>
              <VarItem
                name='sys.query'
                type='string'
                description={t(`${i18nPrefix}.outputVars.query`)}
              />
              {/* Now not support sys.memories */}
              {/* <VarItem
              name='sys.memories'
              type='array[Object]'
              description={t(`${i18nPrefix}.outputVars.memories.des`)}
              subItems={[
                {
                  name: 'type',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.memories.type`),
                },
                {
                  name: 'content',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.memories.content`),
                },
              ]}
            /> */}
              <VarItem
                name='sys.files'
                type='Array[File]'
                description={t(`${i18nPrefix}.outputVars.files`)}
              />
            </>
          </OutputVars>
        </div>
      )}

      {isShowAddVarModal && (
        <ConfigVarModal
          isCreate
          isShow={isShowAddVarModal}
          onClose={hideAddVarModal}
          onConfirm={handleAddVarConfirm}
        />
      )}
    </div>
  )
}

export default React.memo(Panel)
