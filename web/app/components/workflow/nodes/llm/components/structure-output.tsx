'use client'
import type { FC } from 'react'
import type { SchemaRoot, StructuredOutput } from '../types'
import { RiEditLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import ShowPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { cn } from '@/utils/classnames'
import { Type } from '../types'
import JsonSchemaConfigModal from './json-schema-config-modal'

type Props = {
  className?: string
  value?: StructuredOutput
  onChange: (value: StructuredOutput) => void
}

const StructureOutput: FC<Props> = ({
  className,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [showConfig, {
    setTrue: showConfigModal,
    setFalse: hideConfigModal,
  }] = useBoolean(false)

  const handleChange = useCallback((value: SchemaRoot) => {
    onChange({
      schema: value,
    })
  }, [onChange])
  return (
    <div className={cn(className)}>
      <div className="flex justify-between">
        <div className="flex items-center leading-[18px]">
          <div className="code-sm-semibold text-text-secondary">structured_output</div>
          <div className="system-xs-regular ml-2 text-text-tertiary">object</div>
        </div>
        <Button
          size="small"
          variant="secondary"
          className="flex"
          onClick={showConfigModal}
        >
          <RiEditLine className="mr-1 size-3.5" />
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
            <div className="system-xs-regular mt-1.5 flex h-10 cursor-pointer items-center justify-center rounded-[10px] bg-background-section text-text-tertiary" onClick={showConfigModal}>{t('structOutput.notConfiguredTip', { ns: 'app' })}</div>
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
export default React.memo(StructureOutput)
