export const jsonConfigPlaceHolder = JSON.stringify(
  {
    type: 'object',
    properties: {
      foo: {
        type: 'string',
      },
      bar: {
        type: 'object',
        properties: {
          sub: {
            type: 'number',
          },
        },
        required: [],
        additionalProperties: true,
      },
    },
    required: [],
    additionalProperties: true,
  },
  null,
  2,
)
