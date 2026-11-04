import type { Describable, SearchDoc } from './search'
import { expect, it } from 'vite-plus/test'
import { search, searchDoc } from './search'

function doc(id: string, source: Partial<Describable>, deprecated = false): SearchDoc {
  return searchDoc(id, { summary: '', input: {}, examples: [], ...source }, deprecated)
}

const DOCS = [
  doc('run.console_app.chat', { summary: 'Run a chat or agent app' }),
  doc('run.console_app.workflow', { summary: 'Run a workflow app' }),
  doc('get.console_app', { input: { properties: { page: { description: 'Page number' } } } }),
  doc('console_app.run', { summary: 'Deprecated: use the per-mode run' }, true),
]
const ids = (query: string) => search(DOCS, query, { limit: 20 }).hits.map((hit) => hit.id)

it('ranks id tokens first, reaches schema text, takes compounds and typos, keeps deprecated last', () => {
  expect(ids('workflow')[0]).toBe('run.console_app.workflow')
  expect(ids('agents nonsense')).toEqual(['run.console_app.chat'])
  expect(ids('page')).toEqual(['get.console_app'])
  expect(ids('chatbot')[0]).toBe('run.console_app.chat')
  expect(ids('worflow')[0]).toBe('run.console_app.workflow')
  expect(ids('running').at(-1)).toBe('console_app.run')
  expect(search(DOCS, 'app', { limit: 1 })).toMatchObject({ total: 4 })
  expect(ids('the zebra')).toEqual([])
})
