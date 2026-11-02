import { renderWorkflowFlowHook as renderHook } from '../../../../__tests__/workflow-test-env'
import { useChat } from '../../hooks'

describe('workflow debug useChat – opening statement stability', () => {
  it('should return empty chatList when config has no opening_statement', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    expect(result.current.chatList).toEqual([])
  })

  it('should preserve reference when inputs change but produce identical content', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: ['Ask {{name}}'],
    }
    const formSettings = { inputs: { name: 'Alice' }, inputsForm: [] }

    const { result, rerender } = renderHook(({ fs }) => useChat(config, fs), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      initialProps: { fs: formSettings },
    })

    const openerBefore = result.current.chatList[0]
    expect(openerBefore!.content).toBe('Hello Alice')
    expect(openerBefore!.id).toBe('opening-statement')

    rerender({ fs: { inputs: { name: 'Alice' }, inputsForm: [] } })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter).toBe(openerBefore)
  })

  it('updates opening content when the substituted input changes', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: [],
    }

    const { result, rerender } = renderHook(({ fs }) => useChat(config, fs), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      initialProps: { fs: { inputs: { name: 'Alice' }, inputsForm: [] } },
    })

    const openerBefore = result.current.chatList[0]
    expect(openerBefore!.content).toBe('Hello Alice')
    expect(openerBefore!.id).toBe('opening-statement')

    rerender({ fs: { inputs: { name: 'Bob' }, inputsForm: [] } })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter!.content).toBe('Hello Bob')
  })

  it('should preserve reference for existing opening statement in prevChatTree', () => {
    const config = {
      opening_statement: 'Updated welcome',
      suggested_questions: ['S1'],
    }
    const prevChatTree = [
      {
        id: 'opening-statement',
        content: 'old',
        isAnswer: true,
        isOpeningStatement: true,
        suggestedQuestions: [],
      },
    ]

    const { result, rerender } = renderHook(({ cfg }) => useChat(cfg, undefined, prevChatTree), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      initialProps: { cfg: config },
    })

    const openerBefore = result.current.chatList[0]
    expect(openerBefore!.content).toBe('Updated welcome')

    rerender({ cfg: config })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter).toBe(openerBefore)
  })

  it('should include suggestedQuestions in opening statement when config has them', () => {
    const config = {
      opening_statement: 'Welcome!',
      suggested_questions: ['How are you?', 'What can you do?'],
    }
    const { result } = renderHook(() => useChat(config), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    const opener = result.current.chatList[0]
    expect(opener!.suggestedQuestions).toEqual(['How are you?', 'What can you do?'])
  })
})
