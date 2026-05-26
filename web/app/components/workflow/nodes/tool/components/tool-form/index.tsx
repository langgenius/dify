'use client'
import type { FC } from 'react'
import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useEffect, useMemo, useRef } from 'react'
import { isToolSettingShowOnSatisfied } from '@/app/components/plugins/plugin-detail-panel/tool-selector/utils/show-on'
import { resetToolSettingFieldValue } from '@/app/components/tools/utils/to-form-schema'
import ToolFormItem from './item'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema[]
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
  inPanel?: boolean
  currentTool?: Tool
  currentProvider?: ToolWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, any>
}

const ToolForm: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentTool,
  currentProvider,
  showManageInputField,
  onManageInputField,
  extraParams,
}) => {
  const visibleSchemas = useMemo(
    () => schema.filter(s => isToolSettingShowOnSatisfied(s.show_on, value)),
    [schema, value],
  )

  const schemaVarsKey = useMemo(() => schema.map(s => s.variable).join('\0'), [schema])
  const prevVisibleVarsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    prevVisibleVarsRef.current = null
  }, [schemaVarsKey])

  useEffect(() => {
    const currentVisible = new Set(visibleSchemas.map(s => s.variable))
    if (prevVisibleVarsRef.current === null) {
      prevVisibleVarsRef.current = currentVisible
      return
    }
    const prevVisible = prevVisibleVarsRef.current
    const patch: Partial<ToolVarInputs> = {}
    for (const s of schema) {
      const variable = s.variable
      const wasVisible = prevVisible.has(variable)
      const nowVisible = currentVisible.has(variable)
      if (wasVisible && !nowVisible)
        patch[variable] = resetToolSettingFieldValue(s as { type: string, default?: string })
    }
    prevVisibleVarsRef.current = currentVisible
    if (Object.keys(patch).length > 0)
      onChange({ ...value, ...patch } as ToolVarInputs)
  }, [visibleSchemas, schema, schemaVarsKey, value, onChange])

  return (
    <div className="space-y-1">
      {
        visibleSchemas.map(formSchema => (
          <ToolFormItem
            key={formSchema.variable}
            readOnly={readOnly}
            nodeId={nodeId}
            schema={formSchema}
            value={value}
            onChange={onChange}
            inPanel={inPanel}
            currentTool={currentTool}
            currentProvider={currentProvider}
            showManageInputField={showManageInputField}
            onManageInputField={onManageInputField}
            extraParams={extraParams}
            providerType="tool"
          />
        ))
      }
    </div>
  )
}
export default ToolForm
