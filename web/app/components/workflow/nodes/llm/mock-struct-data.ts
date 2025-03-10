import { type StructuredOutput, Type } from './types'

const data: StructuredOutput = {
  schema: {
    type: Type.object,
    properties: {
      string_field: {
        type: Type.string,
        description: '这是一个字符串类型的字段',
      },
      obj_field: {
        type: Type.object,
        properties: {
          string_field_1: {
            type: Type.string,
            description: 'this is a string type field',
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
          sub_item_d_2: {
            type: Type.object,
            properties: {
              sub_item_3: {
                type: Type.object,
                // generate more than sub item 10 levels
                properties: {
                  sub_item_4: {
                    type: Type.object,
                    properties: {
                      sub_item_5: {
                        type: Type.object,
                        properties: {
                          sub_item_6: {
                            type: Type.object,
                            properties: {
                              sub_item_7: {
                                type: Type.object,
                                properties: {
                                  sub_item_8: {
                                    type: Type.object,
                                    properties: {
                                      sub_item_9: {
                                        type: Type.object,
                                        properties: {
                                          sub_item_10: {
                                            type: Type.object,
                                            properties: {
                                              sub_item_11: {
                                                type: Type.object,
                                                properties: {
                                                  sub_item_12: {
                                                    type: Type.object,
                                                    description: 'This is a object type field.This is a object type field.This is a object type field.',
                                                  },
                                                },
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          number_field_3: {
            type: Type.number,
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
