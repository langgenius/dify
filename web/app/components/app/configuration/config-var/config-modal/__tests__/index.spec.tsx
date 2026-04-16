import type { InputVar } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { InputVarType } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import ConfigModal from '../index'

const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: '',
  variable: 'question',
  required: false,
  hide: false,
  options: [],
  default: 'hello',
  max_length: 32,
  ...overrides,
})

describe('ConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      appDetail: {
        mode: AppModeEnum.CHAT,
      } as App & Partial<AppSSO>,
    })
  })

  it('should copy the variable name into the label when the label is empty', () => {
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const textboxes = screen.getAllByRole('textbox')
    fireEvent.blur(textboxes[0]!, { target: { value: 'question' } })

    expect(textboxes[1])!.toHaveValue('question')
  })

  it('should submit the edited payload when the form is valid', () => {
    const onConfirm = vi.fn()
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload({ label: 'Question' })}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'updated default' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      default: 'updated default',
      label: 'Question',
      variable: 'question',
    }), undefined)
  })

  it('should block save when the label is missing', () => {
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload({ label: '' })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(toastErrorSpy).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.labelNameRequired')
  })
})
