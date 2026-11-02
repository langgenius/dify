import { fireEvent, render, screen } from '@testing-library/react'
import { CredentialIcon } from '../credential-icon'

beforeEach(() => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('keeps decorative credential images and fallback text out of the accessibility tree', () => {
  const { container } = render(<CredentialIcon name="Alice" />)

  expect(screen.getByText('A').closest('[aria-hidden="true"]')).not.toBeNull()
  expect(container.querySelector('img')).toHaveAttribute('alt', '')
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it.each([undefined, 'default', 'https://example.com/broken.png'])(
  'loads the newly selected credential after the previous avatar was %s',
  (previousUrl) => {
    const { container, rerender } = render(<CredentialIcon avatarUrl={previousUrl} name="Alice" />)
    if (previousUrl && previousUrl !== 'default') {
      const previousImage = container.querySelector('img')!
      expect(previousImage).not.toHaveAttribute('data-error')
      fireEvent.error(previousImage)
      expect(previousImage).toHaveAttribute('data-error')
    }
    expect(screen.getByText('A')).toBeInTheDocument()

    rerender(<CredentialIcon avatarUrl="https://example.com/bob.png" name="Bob" />)
    const image = container.querySelector('img')!
    expect(image).toHaveAttribute('src', 'https://example.com/bob.png')
    fireEvent.load(image)

    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  },
)
