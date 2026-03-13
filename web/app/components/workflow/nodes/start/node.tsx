import type { FC } from 'react'
import type { StartNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import InputVarTypeIcon from '../_base/components/input-var-type-icon'

const i18nPrefix = 'nodes.start'

const Node: FC<NodeProps<StartNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()
  const { variables } = data

  if (!variables.length)
    return null

  return (
    <div className="mb-1 px-3 py-1">
      <div className="space-y-0.5">
        {variables.map(variable => (
          <div key={variable.variable} className="flex h-6 items-center justify-between space-x-1 rounded-md  bg-workflow-block-parma-bg px-1">
            <div className="flex w-0 grow items-center space-x-1">
              <Variable02 className="h-3.5 w-3.5 shrink-0 text-text-accent" />
              <span className="system-xs-regular w-0 grow truncate text-text-secondary">{variable.variable}</span>
            </div>

            <div className="ml-1 flex items-center space-x-1">
              {variable.required && <span className="system-2xs-regular-uppercase text-text-tertiary">{t(`${i18nPrefix}.required`, { ns: 'workflow' })}</span>}
              <InputVarTypeIcon type={variable.type} className="h-3 w-3 text-text-tertiary" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(Node)
