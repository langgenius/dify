import type { DifyBuilderConversationItemResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  flattenConversationGroups,
  groupConversationItems,
} from '../conversation/group-conversation-items'
import { getDifyBuilderErrorMessage } from '../error-message'
import { resolveActionPayload } from '../interactions/interaction-policy'
import { shouldStartBuildSession } from '../utils'

const conversationItem = (
  seq: number,
  kind: string,
  payload: Record<string, unknown> = {},
): DifyBuilderConversationItemResponse => ({
  seq,
  kind,
  payload,
  at_version: 1,
})

describe('App Builder utilities', () => {
  describe('shouldStartBuildSession', () => {
    it('uses Build for an empty canvas or a canvas containing only entry nodes', () => {
      expect(shouldStartBuildSession([], 0)).toBe(true)
      expect(
        shouldStartBuildSession(
          [{ data: { type: BlockEnum.Start } }, { data: { type: BlockEnum.TriggerWebhook } }],
          0,
        ),
      ).toBe(true)
    })

    it('uses Edit when the canvas has a workflow edge or an executable node', () => {
      expect(shouldStartBuildSession([{ data: { type: BlockEnum.Start } }], 1)).toBe(false)
      expect(shouldStartBuildSession([{ data: { type: BlockEnum.LLM } }], 0)).toBe(false)
    })
  })

  it('groups an assistant reply with the cards declared by its contract', () => {
    const items = [
      conversationItem(0, 'user'),
      conversationItem(1, 'form'),
      conversationItem(2, 'challenge'),
      conversationItem(3, 'assistant_turn', { cards: ['form', 'challenge'] }),
      conversationItem(4, 'notice'),
    ]
    const groups = groupConversationItems(items)

    expect(flattenConversationGroups(groups).map(({ item }) => item.kind)).toEqual([
      'user',
      'assistant_turn',
      'form',
      'challenge',
      'notice',
    ])
    expect(groups[1]).toMatchObject({ type: 'assistant', invalidated: false })
  })

  it('propagates an invalidated assistant turn to all of its attached cards', () => {
    const groups = groupConversationItems([
      conversationItem(1, 'plan'),
      conversationItem(2, 'checkpoint'),
      conversationItem(3, 'assistant_turn', {
        cards: ['plan', 'checkpoint'],
        card_state: 'invalidated',
      }),
    ])

    expect(flattenConversationGroups(groups)).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ kind: 'assistant_turn' }),
        invalidated: true,
      }),
      expect.objectContaining({
        item: expect.objectContaining({ kind: 'plan' }),
        invalidated: true,
      }),
      expect.objectContaining({
        item: expect.objectContaining({ kind: 'checkpoint' }),
        invalidated: true,
      }),
    ])
  })

  it('does not attach pending cards when the assistant contract does not match them', () => {
    const groups = groupConversationItems([
      conversationItem(1, 'plan'),
      conversationItem(2, 'assistant_turn', { cards: ['change_set'] }),
    ])

    expect(groups).toMatchObject([
      { type: 'standalone', item: { kind: 'plan' } },
      { type: 'assistant', cards: [] },
    ])
  })

  it('builds special action payloads at the interaction boundary', () => {
    const checklistPayload = { passed: false, remaining: [{ node_id: 'node-1' }] }

    expect(resolveActionPayload('recheck', {}, checklistPayload)).toBe(checklistPayload)
    expect(resolveActionPayload('provide_testdata', {}, checklistPayload)).toEqual({ mode: 'mock' })
    expect(resolveActionPayload('approve_plan', { approved: true }, checklistPayload)).toEqual({
      approved: true,
    })
  })

  describe('getDifyBuilderErrorMessage', () => {
    const copy = {
      fallback: 'Action failed',
      codeMessages: { session_busy: 'App Builder is still processing' },
    }

    it('maps a code-only response to user-facing copy', async () => {
      const response = new Response(JSON.stringify({ code: 'session_busy' }), {
        status: 409,
        statusText: 'Conflict',
      })

      await expect(getDifyBuilderErrorMessage(response, copy)).resolves.toBe(
        'App Builder is still processing',
      )
    })

    it('extracts messages from JSON, text, validation details, and Error objects', async () => {
      const errors = [
        new Response(JSON.stringify({ message: 'Model unavailable' }), { status: 400 }),
        new Response('Gateway timeout', { status: 502 }),
        new Response(JSON.stringify({ detail: [{ msg: 'Field required' }] }), { status: 422 }),
        new Error('Draft sync failed'),
      ]

      await expect(
        Promise.all(errors.map((error) => getDifyBuilderErrorMessage(error, copy))),
      ).resolves.toEqual([
        'Model unavailable',
        'Gateway timeout',
        'Field required',
        'Draft sync failed',
      ])
    })

    it('keeps an unknown backend code visible for diagnosis', async () => {
      const response = new Response(JSON.stringify({ code: 'new_error' }), { status: 400 })

      await expect(getDifyBuilderErrorMessage(response, copy)).resolves.toBe(
        'Action failed (new_error)',
      )
    })
  })
})
