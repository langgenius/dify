export const jsonObjectWrap = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: true,
}

export const jsonConfigPlaceHolder = JSON.stringify(
  {
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
  }, null, 2,
)
