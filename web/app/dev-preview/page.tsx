'use client'

import { useState } from 'react'
import { type SchemaRoot, Type } from '../components/workflow/nodes/llm/types'
import JsonSchemaConfigModal from '../components/workflow/nodes/llm/components/json-schema-config-modal'

export default function Page() {
  const [show, setShow] = useState(false)
  const [schema, setSchema] = useState<SchemaRoot>({
    type: Type.object,
    properties: {
      userId: {
        type: Type.number,
        description: 'The user ID',
      },
      id: {
        type: Type.number,
      },
      title: {
        type: Type.string,
      },
      locations: {
        type: Type.array,
        items: {
          type: Type.object,
          properties: {
            x: {
              type: Type.object,
              properties: {
                x1: {
                  type: Type.array,
                  items: {
                    type: Type.number,
                  },
                },
              },
              required: [
                'x1',
              ],
            },
            y: {
              type: Type.number,
            },
          },
          required: [
            'x',
            'y',
          ],
        },
      },
      completed: {
        type: Type.boolean,
      },
    },
    required: [
      'userId',
      'id',
      'title',
    ],
    additionalProperties: false,
  })

  return <div className='flex flex-col p-20 h-full w-full overflow-hidden'>
    <button onClick={() => setShow(true)} className='shrink-0'>Open Json Schema Config</button>
    {show && (
      <JsonSchemaConfigModal
        isShow={show}
        defaultSchema={schema}
        onSave={(schema) => {
          setSchema(schema)
        }}
        onClose={() => setShow(false)}
      />
    )}
    <pre className='bg-gray-50 p-4 rounded-lg overflow-auto grow'>
      {JSON.stringify(schema, null, 2)}
    </pre>
  </div>
}
