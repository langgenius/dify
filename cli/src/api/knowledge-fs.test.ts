import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeFsClient } from './knowledge-fs'

describe('KnowledgeFsClient command endpoints', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it.each([
    {
      command: 'cat',
      body: {
        content_type: 'text/markdown',
        path: '/knowledge/read me.md',
        text: 'hello',
        truncated: false,
      },
      invoke: (client: KnowledgeFsClient) =>
        client.cat('workspace with space', 'control/space', {
          path: '/knowledge/read me.md',
          limit: 10,
        }),
      query: { path: '/knowledge/read me.md', limit: '10' },
    },
    {
      command: 'diff',
      body: {
        mode: 'line',
        new_path: '/knowledge/new.md',
        old_path: '/knowledge/old.md',
        operations: [],
        stats: { delete: 0, equal: 0, insert: 0 },
      },
      invoke: (client: KnowledgeFsClient) =>
        client.diff('workspace with space', 'control/space', {
          old_path: '/knowledge/old.md',
          new_path: '/knowledge/new.md',
          mode: 'line',
          semantic: true,
        }),
      query: {
        old_path: '/knowledge/old.md',
        new_path: '/knowledge/new.md',
        mode: 'line',
        semantic: 'true',
      },
    },
    {
      command: 'find',
      body: { items: [], path: '/knowledge', truncated: false },
      invoke: (client: KnowledgeFsClient) =>
        client.find('workspace with space', 'control/space', {
          path: '/knowledge',
          limit: 20,
          name_contains: 'readme',
        }),
      query: { path: '/knowledge', limit: '20', name_contains: 'readme' },
    },
    {
      command: 'grep',
      body: { matches: [], path: '/knowledge', truncated: false },
      invoke: (client: KnowledgeFsClient) =>
        client.grep('workspace with space', 'control/space', {
          path: '/knowledge',
          query: 'TODO',
          limit: 20,
        }),
      query: { path: '/knowledge', query: 'TODO', limit: '20' },
    },
    {
      command: 'ls',
      body: { items: [], path: '/knowledge', truncated: false },
      invoke: (client: KnowledgeFsClient) =>
        client.list('workspace with space', 'control/space', {
          path: '/knowledge',
          limit: 20,
        }),
      query: { path: '/knowledge', limit: '20' },
    },
    {
      command: 'stat',
      body: {
        metadata: {},
        path: '/knowledge/readme.md',
        resource_type: 'document',
        target_id: 'document-1',
      },
      invoke: (client: KnowledgeFsClient) =>
        client.stat('workspace with space', 'control/space', {
          path: '/knowledge/readme.md',
        }),
      query: { path: '/knowledge/readme.md' },
    },
    {
      command: 'tree',
      body: {
        path: '/knowledge',
        root: { kind: 'directory', metadata: {}, name: 'knowledge', path: '/knowledge' },
        truncated: false,
      },
      invoke: (client: KnowledgeFsClient) =>
        client.tree('workspace with space', 'control/space', {
          path: '/knowledge',
          limit: 20,
          depth: 3,
        }),
      query: { path: '/knowledge', limit: '20', depth: '3' },
    },
  ])('GETs the independent $command endpoint', async ({ command, body, invoke, query }) => {
    stub = await startStubServer((cap) => jsonResponder(200, body, cap))
    const client = new KnowledgeFsClient(testHttpClient(stub.url, 'dfoa_test'))

    await invoke(client)

    const url = new URL(stub.captured.url ?? '', 'http://dify.test')
    expect(stub.captured.method).toBe('GET')
    expect(url.pathname).toBe(
      `/openapi/v1/workspaces/workspace%20with%20space/knowledge-fs/spaces/control%2Fspace/fs/${command}`,
    )
    expect(Object.fromEntries(url.searchParams)).toEqual(query)
    expect(stub.captured.body).toBe('')
  })
})
