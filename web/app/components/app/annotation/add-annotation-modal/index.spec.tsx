import type { Mock } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useProviderContext } from '@/context/provider-context'
import AddAnnotationModal from './index'

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(args => mockToastNotify(args)),
  },
}))

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <div data-testid="annotation-full" />,
}))

const mockUseProviderContext = useProviderContext as Mock

const getProviderContext = ({ usage = 0, total = 10, enableBilling = false } = {}) => ({
  plan: {
    usage: { annotatedResponse: usage },
    total: { annotatedResponse: total },
  },
  enableBilling,
})

describe('AddAnnotationModal', () => {
  const baseProps = {
    isShow: true,
    onHide: vi.fn(),
    onAdd: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue(getProviderContext())
  })

  const typeQuestion = (value: string) => {
    fireEvent.change(screen.getByPlaceholderText('appAnnotation.addModal.queryPlaceholder'), {
      target: { value },
    })
  }

  const typeAnswer = (value: string) => {
    fireEvent.change(screen.getByPlaceholderText('appAnnotation.addModal.answerPlaceholder'), {
      target: { value },
    })
  }

  it('should render modal title when drawer is visible', () => {
    render(<AddAnnotationModal {...baseProps} />)

    expect(screen.getByText('appAnnotation.addModal.title')).toBeInTheDocument()
  })

  it('should capture query input text when typing', () => {
    render(<AddAnnotationModal {...baseProps} />)
    typeQuestion('Sample question')
    expect(screen.getByPlaceholderText('appAnnotation.addModal.queryPlaceholder')).toHaveValue('Sample question')
  })

  it('should capture answer input text when typing', () => {
    render(<AddAnnotationModal {...baseProps} />)
    typeAnswer('Sample answer')
    expect(screen.getByPlaceholderText('appAnnotation.addModal.answerPlaceholder')).toHaveValue('Sample answer')
  })

  it('should show annotation full notice and disable submit when quota exceeded', () => {
    mockUseProviderContext.mockReturnValue(getProviderContext({ usage: 10, total: 10, enableBilling: true }))
    render(<AddAnnotationModal {...baseProps} />)

    expect(screen.getByTestId('annotation-full')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
  })

  it('should call onAdd with form values when create next enabled', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<AddAnnotationModal {...baseProps} onAdd={onAdd} />)

    typeQuestion('Question value')
    typeAnswer('Answer value')
    fireEvent.click(screen.getByTestId('checkbox-create-next-checkbox'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    })

    expect(onAdd).toHaveBeenCalledWith({ question: 'Question value', answer: 'Answer value' })
  })

  it('should reset fields after saving when create next enabled', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<AddAnnotationModal {...baseProps} onAdd={onAdd} />)

    typeQuestion('Question value')
    typeAnswer('Answer value')
    const createNextToggle = screen.getByText('appAnnotation.addModal.createNext').previousElementSibling as HTMLElement
    fireEvent.click(createNextToggle)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    })

    await waitFor(() => {
      expect(screen.getByPlaceholderText('appAnnotation.addModal.queryPlaceholder')).toHaveValue('')
      expect(screen.getByPlaceholderText('appAnnotation.addModal.answerPlaceholder')).toHaveValue('')
    })
  })

  it('should show toast when validation fails for missing question', () => {
    render(<AddAnnotationModal {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'appAnnotation.errorMessage.queryRequired',
    }))
  })

  it('should show toast when validation fails for missing answer', () => {
    render(<AddAnnotationModal {...baseProps} />)
    typeQuestion('Filled question')
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'appAnnotation.errorMessage.answerRequired',
    }))
  })

  it('should close modal when save completes and create next unchecked', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<AddAnnotationModal {...baseProps} onAdd={onAdd} />)

    typeQuestion('Q')
    typeAnswer('A')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    })

    expect(baseProps.onHide).toHaveBeenCalled()
  })

  it('should allow cancel button to close the drawer', () => {
    render(<AddAnnotationModal {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(baseProps.onHide).toHaveBeenCalled()
  })
})
