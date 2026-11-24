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
  // The separator border sits inside the avatar's size, so the fallback fills what is left.
  expect(avatar.getBoundingClientRect().width).toBe(24)
  expect(fallback.getBoundingClientRect().width).toBe(22)
  expect(getComputedStyle(avatar).borderWidth).toBe('1px')
  expect(getComputedStyle(avatar).boxShadow).toBe('none')
  expect(getComputedStyle(button).borderWidth).toBe('0px')
  expect(screen.getByRole('img', { name: 'Bob' }).element().getBoundingClientRect().width).toBe(20)
  expect(
    screen.getByRole('img', { name: '2 more people' }).element().getBoundingClientRect().width,
  ).toBe(24)
})

it.each(['ltr', 'rtl'])('lays out and stacks items from the inline start in %s', async (dir) => {
  const alice = (
    <button key="alice" type="button" aria-label="Open Alice">
      <Avatar aria-hidden="true">
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    </button>
  )
  const bob = (
    <Avatar key="bob" role="img" aria-label="Bob">
      <AvatarFallback>B</AvatarFallback>
    </Avatar>
  )
  const count = (
    <AvatarGroupCount key="count" data-testid="count">
      +2
    </AvatarGroupCount>
  )
  const screen = await render(<AvatarGroup dir={dir}>{[alice, bob, count]}</AvatarGroup>)
  const aliceButton = screen.getByRole('button', { name: 'Open Alice' }).element()
  const bobAvatar = screen.getByRole('img', { name: 'Bob' }).element()
  const overflowCount = screen.getByTestId('count').element()

  function expectOverlapWinner(front: Element, back: Element) {
    const frontRect = front.getBoundingClientRect()
    const backRect = back.getBoundingClientRect()
    expect(Math.sign(backRect.left - frontRect.left)).toBe(dir === 'ltr' ? 1 : -1)
    const left = Math.max(frontRect.left, backRect.left)
    const right = Math.min(frontRect.right, backRect.right)
    expect(right - left).toBeCloseTo(4)
    const hit = document.elementFromPoint((left + right) / 2, frontRect.top + frontRect.height / 2)
    expect(front.contains(hit)).toBe(true)
  }

  expectOverlapWinner(aliceButton, bobAvatar)
  expectOverlapWinner(bobAvatar, overflowCount)

  await screen.rerender(<AvatarGroup dir={dir}>{[bob, alice, count]}</AvatarGroup>)

  expectOverlapWinner(bobAvatar, aliceButton)
  expectOverlapWinner(aliceButton, overflowCount)
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
