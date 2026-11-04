import type { InputForm } from '../type'
import { renderHook } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { useCheckInputsForms } from '../check-input-forms-hooks'

const mockNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  default: {
    notify: (args: unknown) => mockNotify(args),
  },
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

describe('useCheckInputsForms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should ignore missing but not required inputs', () => {
    const { result } = renderHook(() => useCheckInputsForms())
    const inputsForm = [
      {
        variable: 'test_var',
        label: 'Test Variable',
        required: false,
        type: InputVarType.textInput as string,
      },
    ]
    const isValid = result.current.checkInputsForm({}, inputsForm as InputForm[])

    expect(isValid).toBe(true)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('rejects an empty required file list', () => {
    const { result } = renderHook(() => useCheckInputsForms())
    const fields = [
      {
        variable: 'files',
        label: 'Files',
        required: true,
        hide: false,
        type: InputVarType.multiFiles,
      },
    ]

    expect(result.current.checkInputsForm({ files: [] }, fields)).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'appDebug.errorMessage.valueOfVarRequired:{"key":"Files"}',
    })
  })

  it('should notify and return undefined when a file is still uploading (multiFiles)', () => {
    const { result } = renderHook(() => useCheckInputsForms())
    const inputsForm = [
      {
        variable: 'test_files',
        label: 'Test Files',
        required: true,
        hide: false,
        type: InputVarType.multiFiles as string,
      },
    ]
    const inputs = {
      test_files: [{ transferMethod: TransferMethod.local_file }], // no uploadedId
    }
    const isValid = result.current.checkInputsForm(inputs, inputsForm as InputForm[])

    expect(isValid).toBeUndefined()
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        message: 'appDebug.errorMessage.waitForFileUpload',
      }),
    )
  })

  it('should return true when all files are uploaded and required variables are present', () => {
    const { result } = renderHook(() => useCheckInputsForms())
    const inputsForm = [
      {
        variable: 'test_file',
        label: 'Test File',
        required: true,
        type: InputVarType.singleFile as string,
      },
    ]
    const inputs = {
      test_file: { transferMethod: TransferMethod.local_file, uploadedId: '123' }, // uploaded
    }
    const isValid = result.current.checkInputsForm(inputs, inputsForm as InputForm[])

    expect(isValid).toBe(true)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('should short-circuit remaining fields after first required input is missing', () => {
    const { result } = renderHook(() => useCheckInputsForms())
    const inputsForm = [
      {
        variable: 'missing_text',
        label: 'Missing Text',
        required: true,
        type: InputVarType.textInput as string,
      },
      {
        variable: 'later_file',
        label: 'Later File',
        required: true,
        type: InputVarType.singleFile as string,
      },
    ]
    const inputs = {
      later_file: { transferMethod: TransferMethod.local_file },
    }

    const isValid = result.current.checkInputsForm(inputs, inputsForm as InputForm[])

    expect(isValid).toBe(false)
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('appDebug.errorMessage.valueOfVarRequired'),
      }),
    )
  })

  it('should short-circuit remaining fields after detecting file upload in progress', () => {
    const { result } = renderHook(() => useCheckInputsForms())
    const inputsForm = [
      {
        variable: 'uploading_file',
        label: 'Uploading File',
        required: true,
        type: InputVarType.singleFile as string,
      },
      {
        variable: 'later_required_text',
        label: 'Later Required Text',
        required: true,
        type: InputVarType.textInput as string,
      },
    ]
    const inputs = {
      uploading_file: { transferMethod: TransferMethod.local_file }, // still uploading
      later_required_text: '',
    }

    const isValid = result.current.checkInputsForm(inputs, inputsForm as InputForm[])

    expect(isValid).toBeUndefined()
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        message: 'appDebug.errorMessage.waitForFileUpload',
      }),
    )
  })
})
