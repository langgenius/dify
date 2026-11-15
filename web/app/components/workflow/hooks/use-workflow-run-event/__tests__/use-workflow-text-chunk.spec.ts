import type { TextChunkResponse } from '@/types/workflow'
import { act } from '@testing-library/react'
import { baseRunningData, renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowTextChunk } from '../use-workflow-text-chunk'

it.each([
  {
    label: 'unselected output',
    text: ' World',
    selector: undefined,
    expected: 'Hello World',
    key: 'end.answer',
  },
  {
    label: 'different output',
    text: '42',
    selector: ['end', 'count'],
    expected: 'Hello\n42',
    key: 'end.count',
  },
  {
    label: 'different output already separated',
    text: '\n42',
    selector: ['end', 'count'],
    expected: 'Hello\n42',
    key: 'end.count',
  },
  {
    label: 'same output',
    text: ' world',
    selector: ['end', 'answer'],
    expected: 'Hello world',
    key: 'end.answer',
  },
])('appends $label and activates the result tab', ({ text, selector, expected, key }) => {
  const { result, store } = renderWorkflowHook(() => useWorkflowTextChunk(), {
    initialStoreState: {
      workflowRunningData: baseRunningData({
        resultText: 'Hello',
        resultTextSelectorKey: 'end.answer',
      }),
    },
  })
  const chunk: TextChunkResponse = {
    event: 'text_chunk',
    task_id: 'task-1',
    workflow_run_id: 'run-1',
    data: { text, from_variable_selector: selector },
  }
  act(() => result.current.handleWorkflowTextChunk(chunk))

  expect(store.getState().workflowRunningData).toMatchObject({
    resultText: expected,
    resultTextSelectorKey: key,
    resultTabActive: true,
  })
})
