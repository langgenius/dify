import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeFsClient } from './knowledge-fs'

describe('KnowledgeFsClient command-oriented endpoints', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it.each([
    {
      body: {
        content_type: 'text/markdown',
        has_more: false,
        path: '/knowledge/read me.md',
        text: 'hello',
        truncated: false,
      },
      endpoint: 'fs:cat',
      invoke: (client: KnowledgeFsClient) =>
        client.cat('workspace with space', 'control/space', {
          path: '/knowledge/read me.md',
          page_size: 10,
        }),
      method: 'GET',
      query: { path: '/knowledge/read me.md', page_size: '10' },
    },
    {
      body: {
        mode: 'line',
        new_path: '/knowledge/new.md',
        old_path: '/knowledge/old.md',
        operations: [],
        stats: { delete: 0, equal: 0, insert: 0 },
      },
      endpoint: 'fs:diff',
      invoke: (client: KnowledgeFsClient) =>
        client.diff('workspace with space', 'control/space', {
          old_path: '/knowledge/old.md',
          new_path: '/knowledge/new.md',
          mode: 'line',
          include_semantic_summary: true,
        }),
      method: 'POST',
      requestBody: {
        include_semantic_summary: true,
        mode: 'line',
        new_path: '/knowledge/new.md',
        old_path: '/knowledge/old.md',
      },
      query: {},
    },
    {
      body: { data: [], has_more: false, path: '/knowledge', truncated: false },
      endpoint: 'fs:find',
      invoke: (client: KnowledgeFsClient) =>
        client.find('workspace with space', 'control/space', {
          path: '/knowledge',
          page_size: 20,
          name_contains: 'readme',
        }),
      method: 'GET',
      query: { path: '/knowledge', page_size: '20', name_contains: 'readme' },
    },
    {
      body: { data: [], has_more: false, path: '/knowledge', truncated: false },
      endpoint: 'fs:grep',
      invoke: (client: KnowledgeFsClient) =>
        client.grep('workspace with space', 'control/space', {
          path: '/knowledge',
          text: 'TODO',
          page_size: 20,
        }),
      method: 'GET',
      query: { path: '/knowledge', text: 'TODO', page_size: '20' },
    },
    {
      body: { data: [], has_more: false, path: '/knowledge', truncated: false },
      endpoint: 'fs:ls',
      invoke: (client: KnowledgeFsClient) =>
        client.list('workspace with space', 'control/space', {
          path: '/knowledge',
          page_size: 20,
        }),
      method: 'GET',
      query: { path: '/knowledge', page_size: '20' },
    },
    {
      body: {
        metadata: {},
        path: '/knowledge/readme.md',
        resource_type: 'document',
        target_id: 'document-1',
      },
      endpoint: 'fs:stat',
      invoke: (client: KnowledgeFsClient) =>
        client.stat('workspace with space', 'control/space', {
          path: '/knowledge/readme.md',
        }),
      method: 'GET',
      query: { path: '/knowledge/readme.md' },
    },
    {
      body: {
        has_more: false,
        path: '/knowledge',
        root: { kind: 'directory', metadata: {}, name: 'knowledge', path: '/knowledge' },
        truncated: false,
      },
      endpoint: 'fs:tree',
      invoke: (client: KnowledgeFsClient) =>
        client.tree('workspace with space', 'control/space', {
          path: '/knowledge',
          page_size: 20,
          depth: 3,
        }),
      method: 'GET',
      query: { path: '/knowledge', page_size: '20', depth: '3' },
    },
  ])(
    '$method $endpoint uses the command-specific resource contract',
    async ({ body, endpoint, invoke, method, query, requestBody }) => {
      stub = await startStubServer((cap) => jsonResponder(200, body, cap))
      const client = new KnowledgeFsClient(testHttpClient(stub.url, 'dfoa_test'))

      await invoke(client)

      const url = new URL(stub.captured.url ?? '', 'http://dify.test')
      expect(stub.captured.method).toBe(method)
      expect(url.pathname).toBe(
        `/openapi/v1/workspaces/workspace%20with%20space/knowledge-fs/knowledge-spaces/control%2Fspace/${endpoint}`,
      )
      expect(Object.fromEntries(url.searchParams)).toEqual(query)
      if (requestBody) expect(JSON.parse(stub.captured.body ?? '{}')).toEqual(requestBody)
      else expect(stub.captured.body).toBe('')
    },
  )

  it('tolerates future response resource types', async () => {
    const body = {
      data: [
        {
          kind: 'resource',
          metadata: {},
          name: 'future entry',
          path: '/knowledge/future-entry',
          resource_type: 'future-resource-type',
        },
      ],
      has_more: false,
      path: '/knowledge',
      truncated: false,
    }
    stub = await startStubServer((cap) => jsonResponder(200, body, cap))
    const client = new KnowledgeFsClient(testHttpClient(stub.url, 'dfoa_test'))

    await expect(
      client.list('workspace-1', 'knowledge-space-1', { path: '/knowledge' }),
    ).resolves.toMatchObject(body)
  })
})
