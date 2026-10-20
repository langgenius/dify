import type { ReactElement } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AddAnnotationModal from '../index'

const mockToastNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  default: {
    notify: vi.fn((args) => mockToastNotify(args)),
  },
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
  },
}))

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <div data-testid="annotation-full" />,
}))

let annotationQuota = { size: 0, limit: 10 }

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { annotation_quota_limit: annotationQuota },
  })
}

describe('AddAnnotationModal', () => {
  const baseProps = {
    isShow: true,
    onHide: vi.fn(),
    onAdd: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    annotationQuota = { size: 0, limit: 10 }
  })

  const fill = async (
    user: ReturnType<typeof userEvent.setup>,
    field: 'query' | 'answer',
    value: string,
  ) => {
    await user.type(
      screen.getByPlaceholderText(`appAnnotation.addModal.${field}Placeholder`),
      value,
    )
  }

  it('should show annotation full notice and disable submit when quota exceeded', () => {
    annotationQuota = { size: 10, limit: 10 }
    render(<AddAnnotationModal {...baseProps} />)

    expect(screen.getByTestId('annotation-full')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
  })

  it('should reset fields after saving when create next enabled', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<AddAnnotationModal {...baseProps} onAdd={onAdd} />)

    await fill(user, 'query', 'Question value')
    await fill(user, 'answer', 'Answer value')
    await user.click(screen.getByText('appAnnotation.addModal.createNext'))

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(onAdd).toHaveBeenCalledWith({ question: 'Question value', answer: 'Answer value' })
    expect(baseProps.onHide).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('appAnnotation.addModal.queryPlaceholder')).toHaveValue('')
      expect(screen.getByPlaceholderText('appAnnotation.addModal.answerPlaceholder')).toHaveValue(
        '',
      )
    })
  })

  it('should show toast when validation fails for missing question', async () => {
    const user = userEvent.setup()
    render(<AddAnnotationModal {...baseProps} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(baseProps.onAdd).not.toHaveBeenCalled()
    expect(mockToastNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'appAnnotation.errorMessage.queryRequired',
      }),
    )
  })

  it('should show toast when validation fails for missing answer', async () => {
    const user = userEvent.setup()
    render(<AddAnnotationModal {...baseProps} />)
    await fill(user, 'query', 'Filled question')
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(baseProps.onAdd).not.toHaveBeenCalled()
    expect(mockToastNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'appAnnotation.errorMessage.answerRequired',
      }),
    )
  })

  it('should close modal when save completes and create next unchecked', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<AddAnnotationModal {...baseProps} onAdd={onAdd} />)

    await fill(user, 'query', 'Q')
    await fill(user, 'answer', 'A')

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(onAdd).toHaveBeenCalledWith({ question: 'Q', answer: 'A' })
    expect(baseProps.onHide).toHaveBeenCalled()
  })

  it('should allow cancel button to close the drawer', async () => {
    const user = userEvent.setup()
    render(<AddAnnotationModal {...baseProps} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(baseProps.onHide).toHaveBeenCalled()
  })
})
