import type { KnowledgeRetrievalNodeType } from '../../types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { RETRIEVE_TYPE } from '@/types/app'
import useKnowledgeInputManager from '../use-knowledge-input-manager'

const createInputs = (): KnowledgeRetrievalNodeType => ({
  type: BlockEnum.KnowledgeRetrieval,
  title: 'Knowledge Retrieval',
  desc: '',
  query_variable_selector: ['start', 'problem'],
  query_attachment_selector: ['start', 'files'],
  dataset_ids: [],
  retrieval_mode: RETRIEVE_TYPE.multiWay,
})

describe('useKnowledgeInputManager', () => {
  it('normalizes cleared variable selectors to empty arrays', () => {
    const doSetInputs = vi.fn()
    const inputs = createInputs()
    const { result } = renderHook(() =>
      useKnowledgeInputManager({
        inputs,
        doSetInputs,
      }),
    )

    act(() => {
      result.current.handleQueryVarChange('')
      result.current.handleQueryAttachmentChange('')
    })

    expect(doSetInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query_variable_selector: [],
        query_attachment_selector: [],
      }),
    )
  })

  it('repairs existing malformed selectors when node inputs are saved', () => {
    const doSetInputs = vi.fn()
    const inputs = {
      ...createInputs(),
      query_variable_selector: '' as unknown as ValueSelector,
      query_attachment_selector: '' as unknown as ValueSelector,
    }
    const { result } = renderHook(() =>
      useKnowledgeInputManager({
        inputs,
        doSetInputs,
      }),
    )

    act(() => {
      result.current.setInputs(inputs)
    })

    expect(doSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        query_variable_selector: [],
        query_attachment_selector: [],
      }),
    )
  })

  it('preserves non-empty legacy string selectors as selector arrays', () => {
    const doSetInputs = vi.fn()
    const inputs = createInputs()
    const { result } = renderHook(() =>
      useKnowledgeInputManager({
        inputs,
        doSetInputs,
      }),
    )

    act(() => {
      result.current.handleQueryVarChange('sys.query')
    })

    expect(doSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        query_variable_selector: ['sys', 'query'],
      }),
    )
  })
})
