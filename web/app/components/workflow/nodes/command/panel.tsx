import type { FC } from 'react'
import type { CommandNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import useConfig from './use-config'

const i18nPrefix = 'nodes.command'

const Panel: FC<NodePanelProps<CommandNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleWorkingDirectoryChange,
    handleCommandChange,
  } = useConfig(id, data)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.workingDirectory`, { ns: 'workflow' })}
        >
          <Input
            instanceId="command-working-directory"
            className="w-full rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-3 py-2 text-sm text-components-input-text-filled"
            placeholder={t(`${i18nPrefix}.workingDirectoryPlaceholder`, { ns: 'workflow' }) || ''}
            value={inputs.working_directory || ''}
            onChange={handleWorkingDirectoryChange}
            readOnly={readOnly}
            nodesOutputVars={availableVars}
            availableNodes={availableNodesWithParent}
          />
        </Field>
        <Split />
        <Field
          title={t(`${i18nPrefix}.command`, { ns: 'workflow' })}
          required
        >
          <Input
            instanceId="command-command"
            className="min-h-[120px] w-full rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-3 py-2 font-mono text-sm text-components-input-text-filled"
            placeholder={t(`${i18nPrefix}.commandPlaceholder`, { ns: 'workflow' }) || ''}
            promptMinHeightClassName="min-h-[120px]"
            value={inputs.command || ''}
            onChange={handleCommandChange}
            readOnly={readOnly}
            nodesOutputVars={availableVars}
            availableNodes={availableNodesWithParent}
          />
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
