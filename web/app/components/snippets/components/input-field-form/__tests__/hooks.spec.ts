import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetInputFieldConfigurations } from '../hooks'

const mockUseConfigurations = vi.fn()

vi.mock('@/app/components/rag-pipeline/components/panel/input-field/editor/form/hooks', () => ({
  useConfigurations: (...args: unknown[]) => mockUseConfigurations(...args),
}))

describe('useSnippetInputFieldConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should make text maxLength configuration optional for snippets only', () => {
    mockUseConfigurations.mockReturnValue([
      {
        variable: 'maxLength',
        required: true,
        showConditions: [{ variable: 'type', value: PipelineInputVarType.textInput }],
      },
      {
        variable: 'required',
        required: true,
        showConditions: [],
      },
    ])

    const { result } = renderHook(() => useSnippetInputFieldConfigurations({
      getFieldValue: vi.fn(),
      setFieldValue: vi.fn(),
      supportFile: true,
    }))

    expect(result.current[0].required).toBe(false)
    expect(result.current[1].required).toBe(true)
  })
})
