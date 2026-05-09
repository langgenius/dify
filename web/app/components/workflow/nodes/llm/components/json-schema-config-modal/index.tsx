import type { SchemaRoot } from '../../types'
import Modal from '../../../../../base/modal'
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
    <Modal
      isShow={isShow}
      onClose={onClose}
      className="h-[800px] max-w-[960px] p-0"
    >
      <JsonSchemaConfig
        defaultSchema={defaultSchema}
        onSave={onSave}
        onClose={onClose}
      />
    </Modal>
  )
}
