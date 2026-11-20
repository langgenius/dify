import { fireEvent, render, screen } from '@testing-library/react'
import { UserAvatar } from '.'

const original = '/files/avatar-a/file-preview?timestamp=1&nonce=first&sign=first'
const refreshed = '/files/avatar-a/file-preview?timestamp=2&nonce=next&sign=next'
const failedRefresh = '/files/avatar-a/file-preview?timestamp=3&nonce=failed&sign=failed'

const avatar = (src?: string) => <UserAvatar name="Alice" src={src} role="img" aria-label="Alice" />
const photo = (src: string) =>
  screen.getByRole('img', { name: 'Alice' }).querySelector(`img[src="${src}"]`)

it('keeps the loaded photo through a failed refresh and promotes the next loaded element', () => {
  const { rerender } = render(avatar(original))
  const originalPhoto = photo(original)!
  fireEvent.load(originalPhoto)

  rerender(avatar(failedRefresh))
  fireEvent.error(photo(failedRefresh)!)
  expect(photo(original)).toBe(originalPhoto)
  expect(originalPhoto).not.toHaveAttribute('aria-hidden')

  rerender(avatar(refreshed))
  const pendingPhoto = photo(refreshed)!
  expect(pendingPhoto).toHaveAttribute('aria-hidden', 'true')
  expect(photo(original)).toBe(originalPhoto)

  fireEvent.load(pendingPhoto)
  expect(photo(refreshed)).toBe(pendingPhoto)
  expect(pendingPhoto).not.toHaveAttribute('aria-hidden')
  expect(originalPhoto).not.toBeInTheDocument()
})

it.each([
  '/files/avatar-b/file-preview?timestamp=2&nonce=next&sign=next',
  '/files/avatar-a/file-preview',
  `${refreshed}&variant=thumbnail`,
])('drops the previous photo when the requested asset changes to %s', (newSrc) => {
  const { rerender } = render(avatar(original))
  const originalPhoto = photo(original)!
  fireEvent.load(originalPhoto)

  rerender(avatar(newSrc))
  expect(originalPhoto).not.toBeInTheDocument()
  expect(photo(newSrc)).toHaveAttribute('aria-hidden', 'true')

  rerender(avatar())
  expect(screen.getByRole('img', { name: 'Alice' })).toHaveTextContent('A')
})

it('shows the initials if the first image fails before a photo is available', () => {
  render(avatar(original))
  fireEvent.error(photo(original)!)
  expect(screen.getByRole('img', { name: 'Alice' })).toHaveTextContent('A')
})
