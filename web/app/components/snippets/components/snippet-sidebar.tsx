'use client'

import type { InputVar } from '@/app/components/workflow/types'
import type { SnippetDetail, SnippetInputField } from '@/models/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { isEqual } from 'es-toolkit/predicate'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NavLink from '@/app/components/app-sidebar/nav-link'
import SnippetInfoDropdown from '@/app/components/app-sidebar/snippet-info/dropdown'
import ConfigVarModal from '@/app/components/app/configuration/config-var/config-modal'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import VarList from '@/app/components/workflow/nodes/start/components/var-list'
import { hasDuplicateStr } from '@/utils/var'
import { SnippetPlaceholderIcon } from './snippet-placeholder-icon'

type SnippetSidebarProps = {
  snippet: SnippetDetail
  fields: SnippetInputField[]
  readonly: boolean
  onFieldsChange: (fields: SnippetInputField[]) => void
}

type SnippetSidebarContentProps = SnippetSidebarProps & {
  className?: string
}

const toWorkflowInputVar = (field: SnippetInputField): InputVar => ({
  ...field,
  type: field.type as unknown as InputVar['type'],
})

const toSnippetInputField = (field: InputVar): SnippetInputField => ({
  ...field,
  label: typeof field.label === 'string' ? field.label : field.label.variable,
  type: field.type as unknown as SnippetInputField['type'],
})

const NodeTreeIcon = ({ className }: { className?: string }) => (
  <span className={cn('i-ri-node-tree', className)} />
)

export const SnippetSidebarContent = ({
  snippet,
  fields,
  readonly,
  onFieldsChange,
  className,
}: SnippetSidebarContentProps) => {
  const { t } = useTranslation()
  const [isShowAddVarModal, setIsShowAddVarModal] = useState(false)
  const workflowInputVars = useMemo(() => fields.map(toWorkflowInputVar), [fields])

  const showAddVarModal = useCallback(() => {
    setIsShowAddVarModal(true)
  }, [])

  const hideAddVarModal = useCallback(() => {
    setIsShowAddVarModal(false)
  }, [])

  const validateFields = useCallback((nextFields: SnippetInputField[]) => {
    let errorMsgKey: 'varKeyError.keyAlreadyExists' | '' = ''
    let typeName: 'variableConfig.varName' | 'variableConfig.labelName' | '' = ''
    if (hasDuplicateStr(nextFields.map(item => item.variable))) {
      errorMsgKey = 'varKeyError.keyAlreadyExists'
      typeName = 'variableConfig.varName'
    }
    else if (hasDuplicateStr(nextFields.map(item => item.label as string))) {
      errorMsgKey = 'varKeyError.keyAlreadyExists'
      typeName = 'variableConfig.labelName'
    }

    if (errorMsgKey && typeName) {
      toast.error(t(errorMsgKey, { ns: 'appDebug', key: t(typeName, { ns: 'appDebug' }) }))
      return false
    }

    return true
  }, [t])

  const handleAddVarConfirm = useCallback((payload: InputVar) => {
    const nextFields = [...fields, toSnippetInputField(payload)]
    if (!validateFields(nextFields))
      return

    onFieldsChange(nextFields)
    hideAddVarModal()
  }, [fields, hideAddVarModal, onFieldsChange, validateFields])

  const handleVarListChange = useCallback((list: InputVar[]) => {
    const nextFields = list.map(toSnippetInputField)
    if (isEqual(nextFields, fields))
      return

    onFieldsChange(nextFields)
  }, [fields, onFieldsChange])

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-background-default', className)}>
      <div className="shrink-0 px-3 py-2">
        <div className="flex items-center gap-3">
          <SnippetPlaceholderIcon />
          <div className="min-w-0 grow">
            <div className="truncate system-xl-semibold text-text-primary" title={snippet.name}>{snippet.name}</div>
          </div>
          <SnippetInfoDropdown snippet={snippet} />
        </div>
        {!!snippet.description && (
          <div className="mt-2 truncate system-sm-regular text-text-tertiary" title={snippet.description}>
            {snippet.description}
          </div>
        )}
      </div>

      <nav className="shrink-0 px-3 pt-4">
        <NavLink
          mode="expand"
          name={t('sectionOrchestrate', { ns: 'snippet' })}
          href={`/snippets/${snippet.id}/orchestrate`}
          active
          iconMap={{ selected: NodeTreeIcon, normal: NodeTreeIcon }}
        />
      </nav>

      <div className="flex min-h-0 grow flex-col px-3 pt-6">
        <Field
          title={t('inputVariables', { ns: 'snippet' })}
          operations={!readonly
            ? (
                <button
                  type="button"
                  aria-label={`${t('operation.add', { ns: 'common' })} ${t('inputVariables', { ns: 'snippet' })}`}
                  className={cn(
                    'rounded-md border-none bg-transparent p-1 select-none focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
                    'cursor-pointer hover:bg-state-base-hover',
                  )}
                  onClick={showAddVarModal}
                >
                  <span className="i-ri-add-line size-4 text-text-tertiary" aria-hidden="true" />
                </button>
              )
            : undefined}
        >
          <VarList
            readonly={readonly}
            list={workflowInputVars}
            onChange={handleVarListChange}
          />
        </Field>
      </div>

      {isShowAddVarModal && (
        <ConfigVarModal
          isCreate
          supportFile
          isShow={isShowAddVarModal}
          onClose={hideAddVarModal}
          onConfirm={handleAddVarConfirm}
          showHiddenField={false}
          varKeys={fields.map(v => v.variable)}
        />
      )}
    </div>
  )
}
