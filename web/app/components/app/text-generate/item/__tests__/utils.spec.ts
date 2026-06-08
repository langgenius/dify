/* eslint-disable ts/no-explicit-any */
import {
  buildPromptLogItem,
  getCopyContent,
  getDefaultGenerationTab,
  getGenerationTaskLabel,
  shouldShowWorkflowResultTabs,
} from '../utils'

describe('text generation utils', () => {
  it('should show workflow result tabs when workflow output is present', () => {
    expect(shouldShowWorkflowResultTabs({
      resultText: 'done',
      files: [],
    } as any)).toBe(true)
    expect(getDefaultGenerationTab({
      humanInputFormDataList: [{ formToken: 'token-1' }],
    } as any)).toBe('RESULT')
  })

  it('should keep the detail tab when workflow output is empty', () => {
    expect(shouldShowWorkflowResultTabs({
      files: [],
      humanInputFilledFormDataList: [],
      humanInputFormDataList: [],
      resultText: '',
    } as any)).toBe(false)
    expect(getDefaultGenerationTab(undefined)).toBe('DETAIL')
  })

  it('should build a prompt log item for array messages without duplicating assistant entries', () => {
    const logItem = buildPromptLogItem({
      answer: 'final answer',
      message: [
        { role: 'user', text: 'hello' },
      ],
      message_files: [
        { belongs_to: 'assistant', id: 'file-1' },
        { belongs_to: 'user', id: 'file-2' },
      ],
    })

    expect(logItem.log).toEqual([
      { role: 'user', text: 'hello' },
      {
        role: 'assistant',
        text: 'final answer',
        files: [{ belongs_to: 'assistant', id: 'file-1' }],
      },
    ])
  })

  it('should normalize prompt log items with scalar messages', () => {
    const logItem = buildPromptLogItem({
      answer: 'final answer',
      message: 'raw log',
    })

    expect(logItem.log).toEqual([{ text: 'raw log' }])
  })

  it('should derive task labels and copy content', () => {
    expect(getGenerationTaskLabel('task-1', 1)).toBe('task-1')
    expect(getGenerationTaskLabel('task-1', 3)).toBe('task-1-2')
    expect(getCopyContent({
      content: 'fallback',
      isWorkflow: true,
      workflowProcessData: { resultText: 'workflow-result' } as any,
    })).toBe('workflow-result')
  })
})
