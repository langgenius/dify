import type { Describable, SearchDoc } from './search'
import { expect, it } from 'vite-plus/test'
import { search, searchDoc } from './search'

function doc(id: string, source: Partial<Describable>, deprecated = false): SearchDoc {
  return searchDoc(id, { summary: '', input: {}, examples: [], ...source }, deprecated)
}

it.each(['anyOf', 'oneOf', 'allOf'])('finds fields inside %s schema branches', (keyword) => {
  const docs = [
    doc('run.custom', {
      input: {
        properties: {
          settings: {
            [keyword]: [
              { type: 'object', properties: { retry: { description: 'Backoff duration' } } },
              { type: 'null' },
            ],
          },
        },
      },
    }),
  ]
  expect(search(docs, 'backoff', { limit: 20 }).hits.map((hit) => hit.id)).toEqual(['run.custom'])
})

it('finds map value descriptions without indexing literal example data', () => {
  const docs = [
    doc('run.custom', {
      input: {
        properties: {
          settings: {
            type: 'object',
            additionalProperties: { description: 'Credential alias', type: 'string' },
            default: { description: 'unrelated' },
            examples: [{ title: 'unrelated' }],
          },
        },
      },
    }),
  ]
  expect(search(docs, 'credential', { limit: 20 }).hits.map((hit) => hit.id)).toEqual([
    'run.custom',
  ])
  expect(search(docs, 'unrelated', { limit: 20 }).hits).toEqual([])
})
