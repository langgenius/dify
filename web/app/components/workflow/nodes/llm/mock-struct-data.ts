import { type StructuredOutput, Type } from './types'

const data: StructuredOutput = {
  schema: {
    type: Type.object,
    properties: {
      string_field: {
        type: Type.string,
        description: '可为空',
      },
      obj_field: {
        type: Type.object,
        properties: {
          string_field_1: {
            type: Type.string,
            description: '描述可为空',
          },
          number_field_2: {
            type: Type.number,
            description: '描述可为空',
          },
          array_field_4: {
            type: Type.array,
            items: {
              type: Type.string,
            },
          },
          boolean_field_5: {
            type: Type.boolean,
            description: '描述可为空',
          },
        },
        required: [
          'string_field_1',
          'number_field_2',
          'enum_field_3',
          'array_field_4',
          'boolean_field_5',
        ],
        additionalProperties: false,
      },
    },
    required: [
      'string_field_1',
      'number_field_2',
      'enum_field_3',
      'array_field_4',
      'boolean_field_5',
    ],
    additionalProperties: false,
  },
}

export default data
