import type { StepTwoFile, StepTwoNotionPage } from '../../types'
import type { CrawlResultItem } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { DataSourceType } from '@/models/datasets'
import { usePreviewState } from '../use-preview-state'

const files: StepTwoFile[] = [
  { id: 'file-1', name: 'First.txt', extension: 'txt' },
  { id: 'file-2', name: 'Second.txt', extension: 'txt' },
]
const notionPages: StepTwoNotionPage[] = ['First', 'Second'].map((name, index) => ({
  page_id: `page-${index}`,
  page_name: name,
  workspace_id: 'workspace-1',
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: true,
}))
const websitePages: CrawlResultItem[] = ['First', 'Second'].map((title, index) => ({
  title,
  source_url: `https://example.com/${index}`,
  markdown: title,
  description: '',
}))

it.each([
  [
    DataSourceType.FILE,
    [
      { id: 'file-1', name: 'First.txt', extension: 'txt' },
      { id: 'file-2', name: 'Second.txt', extension: 'txt' },
    ],
  ],
  [
    DataSourceType.NOTION,
    [
      { id: 'page-0', name: 'First', extension: 'md' },
      { id: 'page-1', name: 'Second', extension: 'md' },
    ],
  ],
  [
    DataSourceType.WEB,
    [
      { id: 'https://example.com/0', name: 'First', extension: 'md' },
      { id: 'https://example.com/1', name: 'Second', extension: 'md' },
    ],
  ],
] as const)(
  'maps %s source documents to the picker and changes the selected preview',
  (dataSourceType, expected) => {
    const { result } = renderHook(() =>
      usePreviewState({ dataSourceType, files, notionPages, websitePages }),
    )
    expect(result.current.getPreviewPickerItems()).toEqual(expected)
    expect(result.current.getPreviewPickerValue()).toEqual(expected[0])
    act(() => result.current.handlePreviewChange(expected[1]))
    expect(result.current.getPreviewPickerValue()).toEqual(expected[1])
  },
)
