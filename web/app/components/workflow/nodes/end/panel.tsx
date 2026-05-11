import type { FC } from 'react'
import type { EndNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import useConfig from './use-config'

const i18nPrefix = 'nodes.end'

const Panel: FC<NodePanelProps<EndNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
  } = useConfig(id, data)

  const outputs = inputs.outputs
  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">

        <Field
          title={t(`${i18nPrefix}.output.variable`, { ns: 'workflow' })}
          required
          operations={
            !readOnly
              ? (
                  <button
                    type="button"
                    aria-label={`${t('operation.add', { ns: 'common' })} ${t(`${i18nPrefix}.output.variable`, { ns: 'workflow' })}`}
                    className="cursor-pointer rounded-md border-none bg-transparent p-1 select-none hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                    onClick={handleAddVariable}
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
            list={outputs}
            onChange={handleVarListChange}
          />
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
