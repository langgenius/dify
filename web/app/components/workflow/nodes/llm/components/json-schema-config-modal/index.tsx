import type { SchemaRoot } from '../../types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { JsonSchemaConfig } from './json-schema-config'

type JsonSchemaConfigModalProps = {
  isShow: boolean
  defaultSchema?: SchemaRoot
  onSave: (schema: SchemaRoot) => void
  onClose: () => void
}

export function JsonSchemaConfigModal({
  isShow,
  defaultSchema,
  onSave,
  onClose,
}: JsonSchemaConfigModalProps) {
  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DialogContent className="h-[calc(100dvh-32px)] max-h-[800px] w-full max-w-[960px] overflow-hidden! border-none p-0 text-left align-middle">

        <JsonSchemaConfig
          defaultSchema={defaultSchema}
          onSave={onSave}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
