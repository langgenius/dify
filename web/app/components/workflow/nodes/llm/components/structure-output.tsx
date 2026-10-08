'use client'
import type { SchemaRoot, StructuredOutput } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ShowPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { JsonSchemaConfig } from './json-schema-config-modal/json-schema-config'

type Props = Readonly<{
  className?: string
  value?: StructuredOutput
  onChange: (value: StructuredOutput) => void
  readOnly: boolean
}>

export function StructureOutput({ className, value, onChange, readOnly }: Props) {
  const { t } = useTranslation(['app'])
  // The triggers stay in the summary so it keeps its place when the editing dialog is removed.
  const [dialogHandle] = useState(() => createDialogHandle())
  const configureButtonRef = useRef<HTMLButtonElement>(null)
  const hasSchema = !!value?.schema.properties && Object.keys(value.schema.properties).length > 0

  function handleChange(value: SchemaRoot) {
    onChange({
      schema: value,
    })
    dialogHandle.close()
  }

  return (
    <div className={cn(className)}>
      <div className="flex justify-between">
        <div className="flex items-center leading-4.5">
          <div className="code-sm-semibold text-text-secondary">structured_output</div>
          <div className="ml-2 system-xs-regular text-text-tertiary">object</div>
        </div>
        {!readOnly && (
          <DialogTrigger
            handle={dialogHandle}
            render={
              <Button ref={configureButtonRef} size="small" variant="secondary" className="flex" />
            }
          >
            <i className="i-ri-edit-line size-3.5" aria-hidden="true" />
            <span className="system-xs-medium text-components-button-secondary-text">
              {t(($) => $['structOutput.configure'], { ns: 'app' })}
            </span>
          </DialogTrigger>
        )}
      </div>
      {hasSchema ? (
        <ShowPanel payload={value} />
      ) : readOnly ? (
        <div className="mt-1.5 flex h-10 w-full items-center justify-center rounded-[10px] bg-background-section system-xs-regular text-text-tertiary">
          {t(($) => $['structOutput.notConfiguredTip'], { ns: 'app' })}
        </div>
      ) : (
        <DialogTrigger
          handle={dialogHandle}
          className="mt-1.5 flex h-10 w-full cursor-pointer items-center justify-center rounded-[10px] bg-background-section system-xs-regular text-text-tertiary"
        >
          {t(($) => $['structOutput.notConfiguredTip'], { ns: 'app' })}
        </DialogTrigger>
      )}
      {!readOnly && (
        <Dialog handle={dialogHandle}>
          <DialogContent
            className="h-[calc(100dvh-32px)] max-h-200 w-full max-w-240 overflow-hidden! border-none p-0 text-left align-middle"
            finalFocus={hasSchema ? configureButtonRef : undefined}
          >
            <JsonSchemaConfig defaultSchema={value?.schema} onSave={handleChange} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
