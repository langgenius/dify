import { render } from 'vitest-browser-react'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '..'

const avatarDataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

it('shares the group size through wrappers and keeps explicit avatar sizes', async () => {
  const screen = await render(
    <AvatarGroup size="sm">
      <button type="button" aria-label="Open Alice">
        <Avatar aria-hidden="true">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
      </button>
      <Avatar size="xs" role="img" aria-label="Bob">
        <AvatarFallback>B</AvatarFallback>
      </Avatar>
      <AvatarGroupCount role="img" aria-label="2 more people">
        +2
      </AvatarGroupCount>
    </AvatarGroup>,
  )

  const button = screen.getByRole('button', { name: 'Open Alice' }).element()
  const fallback = screen.getByText('A').element()
  const avatar = fallback.parentElement!
  expect(avatar.getBoundingClientRect().width).toBe(24)
  expect(fallback.getBoundingClientRect().width).toBe(24)
  expect(getComputedStyle(button).borderWidth).toBe('0px')
  expect(getComputedStyle(button).boxShadow).toBe('none')
  expect(getComputedStyle(avatar).boxShadow).not.toBe('none')
  expect(screen.getByRole('img', { name: 'Bob' }).element().getBoundingClientRect().width).toBe(20)
  expect(
    screen.getByRole('img', { name: '2 more people' }).element().getBoundingClientRect().width,
  ).toBe(24)
})

it('keeps a failed mounted image from covering the fallback and displays its replacement', async () => {
  const screen = await render(
    <Avatar role="img" aria-label="Alice">
      <AvatarFallback>A</AvatarFallback>
      <AvatarImage keepMounted src="data:image/png;base64,broken" alt="" />
    </Avatar>,
  )

  await expect.element(screen.getByText('A')).toBeVisible()
  const image = screen.container.querySelector('img')!
  await vi.waitFor(() => {
    expect(image).not.toBeVisible()
    expect(image.getBoundingClientRect().width).toBeGreaterThan(0)
  })
  await expect.element(screen.getByRole('img', { name: 'Alice' })).toBeVisible()

  await screen.rerender(
    <Avatar role="img" aria-label="Alice">
      <AvatarFallback>A</AvatarFallback>
      <AvatarImage keepMounted src={avatarDataUrl} alt="" />
    </Avatar>,
  )

  await vi.waitFor(() => expect(image).toBeVisible())
  await expect.element(screen.getByText('A')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('img', { name: 'Alice' })).toBeVisible()
})
