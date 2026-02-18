import type { FC } from 'react'
import type { StartNodeType } from './types'
import type { InputVar, NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ConfigVarModal from '@/app/components/app/configuration/config-var/config-modal'
import AddButton from '@/app/components/base/button/add-button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import RemoveEffectVarConfirm from '../_base/components/remove-effect-var-confirm'
import VarItem from './components/var-item'
import VarList from './components/var-list'
import useConfig from './use-config'

const i18nPrefix = 'nodes.start'

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
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
  } = useConfig(id, data)

  const handleAddVarConfirm = (payload: InputVar) => {
    const isValid = handleAddVariable(payload)
    if (!isValid)
      return
    hideAddVarModal()
  }

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-2">
        <Field
          title={t(`${i18nPrefix}.inputField`, { ns: 'workflow' })}
          operations={
            !readOnly ? <AddButton onClick={showAddVarModal} /> : undefined
          }
        >
          <>
            <VarList
              readonly={readOnly}
              list={inputs.variables || []}
              onChange={handleVarListChange}
            />

            <div className="mt-1 space-y-1">
              <Split className="my-2" />
              {
                isChatMode && (
                  <VarItem
                    readonly
                    payload={{
                      variable: 'userinput.query',
                    } as any}
                    rightContent={(
                      <div className="text-xs font-normal text-text-tertiary">
                        String
                      </div>
                    )}
                  />
                )
              }

              <VarItem
                readonly
                showLegacyBadge={!isChatMode}
                payload={{
                  variable: 'userinput.files',
                } as any}
                rightContent={(
                  <div className="text-xs font-normal text-text-tertiary">
                    Array[File]
                  </div>
                )}
              />
            </div>
          </>
        </Field>
      </div>

      {isShowAddVarModal && (
        <ConfigVarModal
          isCreate
          supportFile
          isShow={isShowAddVarModal}
          onClose={hideAddVarModal}
          onConfirm={handleAddVarConfirm}
          varKeys={inputs.variables.map(v => v.variable)}
        />
      )}

      <RemoveEffectVarConfirm
        isShow={isShowRemoveVarConfirm}
        onCancel={hideRemoveVarConfirm}
        onConfirm={onRemoveVarConfirm}
      />
    </div>
  )
}

export default React.memo(Panel)
