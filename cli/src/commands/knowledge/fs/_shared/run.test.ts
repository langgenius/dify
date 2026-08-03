import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '@/sys/io/streams'
import { KnowledgeFsOutput } from './output'
import { runKnowledgeFsCommand } from './run'

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000'

function active(): ActiveContext {
  return {
    host: 'cloud.dify.ai',
    email: 'me@example.com',
    ctx: {
      account: { id: 'acct-1', email: 'me@example.com', name: 'Me' },
      workspace: { id: WORKSPACE_ID, name: 'Default', role: 'owner' },
    },
  }
}

describe('runKnowledgeFsCommand', () => {
  it('resolves the active workspace and invokes one command request', async () => {
    const execute = vi.fn(() => Promise.resolve({ path: '/knowledge', data: [] }))

    const result = await runKnowledgeFsCommand(
      { knowledgeSpaceId: 'space-1' },
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        knowledgeFsFactory: () => ({}) as never,
      },
      { label: 'Listing KnowledgeFS', execute },
    )

    expect(execute).toHaveBeenCalledExactlyOnceWith({}, WORKSPACE_ID, 'space-1')
    expect(result.workspaceId).toBe(WORKSPACE_ID)
    expect(result.data).toEqual({ path: '/knowledge', data: [] })
  })

  it('fails before the command request when no workspace can be resolved', async () => {
    const execute = vi.fn(() => Promise.resolve({}))
    const noWorkspace: ActiveContext = {
      host: 'cloud.dify.ai',
      email: 'me@example.com',
      ctx: { account: { id: 'acct-1', email: 'me@example.com', name: 'Me' } },
    }

    await expect(
      runKnowledgeFsCommand(
        { knowledgeSpaceId: 'space-1' },
        {
          active: noWorkspace,
          envLookup: () => undefined,
          http: {} as HttpClient,
          io: bufferStreams(),
          knowledgeFsFactory: () => ({}) as never,
        },
        { label: 'Listing KnowledgeFS', execute },
      ),
    ).rejects.toThrow(/no workspace selected/)
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('KnowledgeFsOutput', () => {
  it('prints cat text and preserves the complete response for structured output', () => {
    const response = {
      content_type: 'text/markdown',
      path: '/knowledge/readme.md',
      text: 'hello',
      truncated: false,
    }
    const output = new KnowledgeFsOutput(response)

    expect(output.text()).toBe('hello\n')
    expect(output.json()).toEqual(response)
  })

  it('pretty-prints non-cat responses in text mode', () => {
    const output = new KnowledgeFsOutput({
      path: '/knowledge',
      data: [],
      has_more: false,
      truncated: false,
    })

    expect(output.text()).toBe(
      '{\n  "path": "/knowledge",\n  "data": [],\n  "has_more": false,\n  "truncated": false\n}\n',
    )
  })
})
