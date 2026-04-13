import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Confirm from '..'

const onCancel = vi.fn()
const onConfirm = vi.fn()
const getOverlay = () => {
  const overlay = document.querySelector('.confirm-dialog-overlay')
  if (!overlay)
    throw new Error('Expected confirm dialog overlay to be rendered')

  return overlay
}

describe('ConfirmDialog wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering scenarios
  describe('Rendering', () => {
    it('should render confirm correctly when isShow is true', async () => {
      render(<Confirm isShow title="test title" onCancel={onCancel} onConfirm={onConfirm} />)

      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
      expect(screen.getByText('test title')).toBeInTheDocument()
    })

    it('should not render when isShow is false', () => {
      render(<Confirm isShow={false} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('should render content when provided', async () => {
      render(<Confirm isShow title="title" content="some description" onCancel={onCancel} onConfirm={onConfirm} />)

      expect(await screen.findByText('some description')).toBeInTheDocument()
    })
  })

  // Prop-driven rendering and state
  describe('Props', () => {
    it('should hide cancel button when showCancel is false', async () => {
      render(<Confirm isShow title="test title" onCancel={onCancel} onConfirm={onConfirm} showCancel={false} />)

      expect(await screen.findByRole('button', { name: 'common.operation.confirm' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.cancel' })).not.toBeInTheDocument()
    })

    it('should hide confirm button when showConfirm is false', async () => {
      render(<Confirm isShow title="test title" onCancel={onCancel} onConfirm={onConfirm} showConfirm={false} />)

      expect(await screen.findByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.confirm' })).not.toBeInTheDocument()
    })

    it('should render custom confirm and cancel text', async () => {
      render(<Confirm isShow title="title" confirmText="Yes" cancelText="No" onCancel={onCancel} onConfirm={onConfirm} />)

      expect(await screen.findByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
    })

    it('should disable confirm button when isDisabled is true', async () => {
      render(<Confirm isShow title="title" isDisabled={true} onCancel={onCancel} onConfirm={onConfirm} />)

      expect(await screen.findByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
    })

    it('should keep cancel button enabled when confirm button is loading', async () => {
      render(<Confirm isShow title="title" isLoading={true} onCancel={onCancel} onConfirm={onConfirm} />)

      expect(await screen.findByRole('button', { name: 'common.operation.cancel' })).toBeEnabled()
      expect(screen.getByRole('button', { name: /common\.operation\.confirm/i })).toBeDisabled()
    })

    it('should disable confirm button until confirm input matches expected value', async () => {
      render(
        <Confirm
          isShow
          title="title"
          confirmInputLabel="Type DELETE to continue"
          confirmInputPlaceholder="DELETE"
          confirmInputValue="DEL"
          confirmInputMatchValue="DELETE"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      )

      expect(await screen.findByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
      expect(screen.getByLabelText('Type DELETE to continue')).toHaveValue('DEL')
    })
  })

  // User interactions
  describe('User Interactions', () => {
    it('should call onCancel when clicking the backdrop', async () => {
      render(<Confirm isShow title="test title" onCancel={onCancel} onConfirm={onConfirm} />)

      const overlay = getOverlay()
      fireEvent.mouseDown(overlay)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should stop propagation on backdrop click', async () => {
      render(<Confirm isShow title="test title" onCancel={onCancel} onConfirm={onConfirm} />)

      const overlay = getOverlay()
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation')

      overlay.dispatchEvent(clickEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('should not close on click away when maskClosable is false', async () => {
      render(<Confirm isShow title="test title" maskClosable={false} onCancel={onCancel} onConfirm={onConfirm} />)

      const overlay = getOverlay()
      fireEvent.mouseDown(overlay)

      expect(onCancel).not.toHaveBeenCalled()
    })

    it('should call onCancel when Escape key is pressed', () => {
      render(<Confirm isShow title="test title" onCancel={onCancel} onConfirm={onConfirm} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should call onConfirm when Enter key is pressed', () => {
      render(<Confirm isShow title="test title" onCancel={onCancel} onConfirm={onConfirm} />)

      fireEvent.keyDown(document, { key: 'Enter' })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })
  })
})
