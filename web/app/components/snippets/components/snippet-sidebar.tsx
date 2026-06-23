'use client'

import type { InputVar } from '@/app/components/workflow/types'
import type { SnippetDetail, SnippetInputField } from '@/models/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { isEqual } from 'es-toolkit/predicate'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import SnippetInfoDropdown from '@/app/components/app-sidebar/snippet-info/dropdown'
import ConfigVarModal from '@/app/components/app/configuration/config-var/config-modal'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import VarList from '@/app/components/workflow/nodes/start/components/var-list'
import Link from '@/next/link'
import { hasDuplicateStr } from '@/utils/var'

type SnippetSidebarProps = {
  snippet: SnippetDetail
  fields: SnippetInputField[]
  readonly: boolean
  onFieldsChange: (fields: SnippetInputField[]) => void
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

const SnippetSidebar = ({
  snippet,
  fields,
  readonly,
  onFieldsChange,
}: SnippetSidebarProps) => {
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
    <aside className="flex h-full w-90 shrink-0 flex-col overflow-hidden rounded-tl-2xl border-r border-divider-subtle bg-background-default">
      <div className="shrink-0 px-6 pt-7">
        <Link
          href="/snippets"
          className="inline-flex items-center gap-2 system-sm-semibold-uppercase text-text-primary hover:text-text-accent"
        >
          <span aria-hidden className="i-ri-arrow-left-line h-4 w-4" />
          {t('management', { ns: 'snippet' })}
        </Link>

        <div className="mt-12 flex items-start gap-3">
          <div className="min-w-0 grow">
            <div className="system-xl-semibold text-text-primary">{snippet.name}</div>
            {!!snippet.description && (
              <div className="mt-3 system-sm-regular text-text-tertiary">
                {snippet.description}
              </div>
            )}
          </div>
          <SnippetInfoDropdown snippet={snippet} />
        </div>
      </div>

      <div className="mx-6 mt-7 h-px shrink-0 bg-divider-subtle" />

      <div className="flex min-h-0 grow flex-col px-6 pt-7">
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
    </aside>
  )
}

export default memo(SnippetSidebar)
