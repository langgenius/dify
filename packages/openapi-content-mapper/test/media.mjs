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

const multipartSchema = {
  type: 'object',
  required: ['file', 'metadata', 'parts'],
  properties: {
    file: binary,
    metadata: { $ref: '#/components/schemas/Metadata' },
    parts: { type: 'array', items: binary },
    optional: binary,
  },
}
const multipart = (schema) => ({
  'Multipart/Form-Data': {
    schema,
    encoding: {
      metadata: { contentType: 'Application/JSON' },
      parts: { contentType: 'application/json' },
      optional: { contentType: 'application/json' },
    },
  },
})
export const multipartSpec = {
  openapi: '3.1.0',
  paths: {
    '/upload-inline': post(multipart(multipartSchema)),
    '/upload-ref': post(multipart({ $ref: '#/components/schemas/Upload' })),
  },
  components: {
    schemas: {
      Upload: multipartSchema,
      Metadata: {
        type: 'object',
        required: ['content'],
        properties: {
          content: binary,
          nullable: { anyOf: [binary, { type: 'null' }] },
          next: { $ref: '#/components/schemas/Metadata' },
        },
      },
    },
  },
}

export const variantMedia = {
  jsonA: 'application/json; profile="A"',
  jsonB: 'application/json; profile="B"',
  formJson: 'multipart/form-data; profile="json"',
  formFile: 'multipart/form-data; profile="file"',
}
const variantFormSchema = {
  type: 'object',
  required: ['metadata'],
  properties: { metadata: binary },
}
export const variantSpec = {
  openapi: '3.1.0',
  paths: {
    '/json': post({
      [variantMedia.jsonA]: { schema: { const: 'A' } },
      [variantMedia.jsonB]: { schema: { const: 'B' } },
    }),
    '/form': post({
      [variantMedia.formJson]: {
        schema: variantFormSchema,
        encoding: { metadata: { contentType: 'application/json; charset=utf-8' } },
      },
      [variantMedia.formFile]: { schema: variantFormSchema },
    }),
  },
}
