const json = (kind) => ({
  schema: {
    type: 'object',
    required: ['kind'],
    properties: { kind: { const: kind } },
  },
})
const post = (content, required = true) => ({
  post: {
    requestBody: { required, content },
    responses: { 204: { description: 'Done' } },
  },
})
const binary = { type: 'string', format: 'binary' }

export const mediaSpec = {
  openapi: '3.1.0',
  paths: {
    '/wildcard': {
      get: { responses: { 200: { content: { '*/*': { schema: binary } } } } },
    },
    '/text-wildcard': {
      get: { responses: { 200: { content: { 'text/*': { schema: { type: 'string' } } } } } },
    },
    '/mixed': post({
      // Deliberately put vendor JSON first: the default must not depend on key order.
      'application/vnd.example+json': json('vendor'),
      'application/json': json('standard'),
      'multipart/form-data': json('form'),
    }),
    '/vendors': post({
      'application/vnd.first+json': json('first'),
      'application/vnd.second+json': json('second'),
    }),
    '/optional-vendors': post(
      {
        'application/vnd.first+json': json('first'),
        'application/vnd.second+json': json('second'),
      },
      false,
    ),
    '/single': post({ 'application/vnd.example+json': json('single') }),
    '/binary': {
      get: {
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['inline', 'referenced'],
                  properties: {
                    inline: binary,
                    referenced: { $ref: '#/components/schemas/Binary' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/vendor-binary': {
      get: {
        responses: {
          200: {
            content: {
              'application/vnd.example+json': {
                schema: { $ref: '#/components/schemas/Binary' },
              },
            },
          },
        },
      },
    },
  },
  components: { schemas: { Binary: binary } },
}
