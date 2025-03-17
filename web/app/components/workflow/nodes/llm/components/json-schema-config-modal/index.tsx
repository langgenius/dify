import React, { type FC } from 'react'
import Modal from '../../../../../base/modal'
import type { SchemaRoot } from '../../types'
import JsonSchemaConfig from './json-schema-config'
import { JsonSchemaConfigContextProvider, MittProvider } from './context'

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
      className='max-w-[960px] h-[800px] p-0'
    >
      <MittProvider>
        <JsonSchemaConfigContextProvider>
          <JsonSchemaConfig
            defaultSchema={defaultSchema}
            onSave={onSave}
            onClose={onClose}
          />
        </JsonSchemaConfigContextProvider>
      </MittProvider >
    </Modal>
  )
}

export default JsonSchemaConfigModal
