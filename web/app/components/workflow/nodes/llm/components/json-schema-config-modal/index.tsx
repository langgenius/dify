import type { FC } from 'react'
import type { SchemaRoot } from '../../types'
import * as React from 'react'
import Modal from '../../../../../base/modal'
import JsonSchemaConfig from './json-schema-config'

type JsonSchemaConfigModalProps = {
  isShow: boolean
  defaultSchema?: SchemaRoot
  onSave: (schema: SchemaRoot) => void
  onClose: () => void
}

const JsonSchemaConfigModal: FC<JsonSchemaConfigModalProps> = ({
  isShow,
  defaultSchema,
  onSave,
  onClose,
}) => {
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

export default JsonSchemaConfigModal
