import type { DocExtractorNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const createData = (overrides: Partial<DocExtractorNodeType> = {}): DocExtractorNodeType => ({
  title: 'Document Extractor',
  desc: '',
  type: BlockEnum.DocExtractor,
  variable_selector: ['start', 'files'],
  is_array_file: false,
  ...overrides,
})

describe('document-extractor/use-single-run-form-params', () => {
  it('exposes a single files form and updates run input values', () => {
    const setRunInputData = vi.fn()

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'doc-node',
      payload: createData(),
      runInputData: { files: ['old-file'] },
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData,
      toVarInputs: () => [],
    }))

    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.inputs).toEqual([
      expect.objectContaining({
        variable: 'files',
        required: true,
      }),
    ])

    result.current.forms[0]!.onChange({ files: ['new-file'] })

    expect(setRunInputData).toHaveBeenCalledWith({ files: ['new-file'] })
    expect(result.current.getDependentVars()).toEqual([['start', 'files']])
    expect(result.current.getDependentVar('files')).toEqual(['start', 'files'])
  })
})
