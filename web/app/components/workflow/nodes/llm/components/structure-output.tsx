'use client'
import type { SchemaRoot, StructuredOutput } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import ShowPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { Type } from '../types'
import { JsonSchemaConfigModal } from './json-schema-config-modal'

type Props = {
  className?: string
  value?: StructuredOutput
  onChange: (value: StructuredOutput) => void
}

export function StructureOutput({
  className,
  value,
  onChange,
}: Props) {
  const { t } = useTranslation()
  const [showConfig, {
    setTrue: showConfigModal,
    setFalse: hideConfigModal,
  }] = useBoolean(false)

  function handleChange(value: SchemaRoot) {
    onChange({
      schema: value,
    })
  }

  return (
    <div className={cn(className)}>
      <div className="flex justify-between">
        <div className="flex items-center leading-[18px]">
          <div className="code-sm-semibold text-text-secondary">structured_output</div>
          <div className="ml-2 system-xs-regular text-text-tertiary">object</div>
        </div>
        <Button
          size="small"
          variant="secondary"
          className="flex"
          onClick={showConfigModal}
        >
          <i className="mr-1 i-ri-edit-line size-3.5" aria-hidden="true" />
          <div className="system-xs-medium text-components-button-secondary-text">{t('structOutput.configure', { ns: 'app' })}</div>
        </Button>
      </div>
      {(value?.schema && value.schema.properties && Object.keys(value.schema.properties).length > 0)
        ? (
            <ShowPanel
              payload={value}
            />
          )
        : (
            <button
              type="button"
              className="mt-1.5 flex h-10 w-full cursor-pointer items-center justify-center rounded-[10px] bg-background-section system-xs-regular text-text-tertiary"
              onClick={showConfigModal}
            >
              {t('structOutput.notConfiguredTip', { ns: 'app' })}
            </button>
          )}

      {showConfig && (
        <JsonSchemaConfigModal
          isShow
          defaultSchema={(value?.schema || {
            type: Type.object,
            properties: {},
            required: [],
            additionalProperties: false,
          }) as any} // wait for types change
          onSave={handleChange as any} // wait for types change
          onClose={hideConfigModal}
        />
      )}
    </div>
  )
}
