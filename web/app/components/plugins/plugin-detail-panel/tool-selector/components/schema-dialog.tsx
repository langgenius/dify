'use client'
import type { Field } from '@/app/components/workflow/nodes/llm/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import {
  MittProvider,
  VisualEditorContextProvider,
} from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/context'
import { SchemaPreview } from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/schema-preview'

type SchemaDialogProps = {
  schema?: Field | null
  rootName: string
  compact?: boolean
}

export function SchemaDialog({ schema, rootName, compact = false }: SchemaDialogProps) {
  const { t } = useTranslation(['common', 'workflowAgent'])
  const label = t(($) => $['nodes.agent.clickToViewParameterSchema'], { ns: 'workflowAgent' })
  const button = compact ? (
    <IconButton
      aria-label={`${label}: ${rootName}`}
      size="xs"
      className="ml-0.5"
      disabled={!schema}
    >
      <span aria-hidden className="i-ri-braces-line size-3.5" />
    </IconButton>
  ) : (
    <Button
      aria-label={`JSON Schema: ${rootName}`}
      variant="ghost"
      size="small"
      className="px-1 system-xs-regular text-text-tertiary"
      disabled={!schema}
    >
      <span aria-hidden className="i-ri-braces-line size-3.5" />
      <span>JSON Schema</span>
    </Button>
  )
  const trigger = schema ? <DialogTrigger render={button} /> : button
  const entry = compact ? (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  ) : (
    trigger
  )

  if (!schema) return entry

  return (
    <Dialog>
      {entry}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-240 min-w-0 flex-col overflow-hidden p-0">
        <div className="relative shrink-0 p-6 pr-14 pb-3">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['nodes.agent.parameterSchema'], { ns: 'workflowAgent' })}
          </DialogTitle>
          <DialogClose
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="lg"
                className="absolute top-5 right-5"
              >
                <span aria-hidden className="i-ri-close-line size-4.5" />
              </IconButton>
            }
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pt-2 pb-6">
          <MittProvider>
            <VisualEditorContextProvider>
              <SchemaPreview schema={schema} rootName={rootName} />
            </VisualEditorContextProvider>
          </MittProvider>
        </div>
      </DialogContent>
    </Dialog>
  )
}
