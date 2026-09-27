import type { EmojiIcon } from '..'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconPickerDialog } from '..'
import { emojiCatalogOptions } from '../emoji-data'
import { recommendedEmojis } from '../emoji-styles'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

const emojis = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '😂',
  '🤣',
  '🥲',
  '☺️',
  '😊',
  '😇',
  '🙂',
  '😍',
  '😘',
  '😙',
  '😝',
  '🤪',
  '🤓',
  '😎',
]
const initial: EmojiIcon = { type: 'emoji', icon: '😀', background: '#FEF3F2' }

function Harness() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Choose
      </button>
      <output aria-label="Saved icon">{value.icon}</output>
      <IconPickerDialog
        open={open}
        onOpenChange={setOpen}
        defaultValue={value}
        onConfirm={(next) => {
          if (next.type === 'emoji') setValue(next)
        }}
      />
    </>
  )
}

it('navigates a visible candidate after filtering, confirms with Enter, and discards cancelled drafts', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: emojis.map((emoji, index) => ({ emoji, label: `Face ${index}`, version: 1 })),
    },
  ])
  await render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Choose', exact: true }).click()
  await expect.element(page.getByRole('dialog', { name: 'app.iconPicker.title' })).toBeVisible()
  await expect.element(page.getByRole('tabpanel', { name: 'app.iconPicker.emoji' })).toBeVisible()
  await expect
    .element(page.getByRole('radiogroup', { name: 'app.iconPicker.chooseStyle' }))
    .toBeVisible()
  const input = page.getByRole('combobox', { name: 'app.iconPicker.search' })
  await expect.element(input).toHaveFocus()
  const clear = page.getByRole('button', { name: 'app.iconPicker.clearSearch' })
  await expect.element(clear).not.toBeInTheDocument()
  const unfilteredCount = page.getByRole('gridcell').all().length
  await input.fill('Face')
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(20)
  await userEvent.keyboard('{ArrowDown}{ArrowRight}')
  const activeId = input.element().getAttribute('aria-activedescendant')!
  const active = document.getElementById(activeId)!
  expect(active).not.toBeNull()
  const style = getComputedStyle(active)
  const inactive = page
    .getByRole('gridcell')
    .all()
    .find((cell) => cell.element() !== active)!
  expect(style.backgroundColor).not.toBe(getComputedStyle(inactive.element()).backgroundColor)
  const keyboardBackground = style.backgroundColor
  await inactive.hover()
  await expect.element(input).toHaveAttribute('aria-activedescendant', inactive.element().id)
  expect(getComputedStyle(inactive.element()).backgroundColor).toBe(keyboardBackground)
  expect(document.querySelectorAll('[role="gridcell"][data-highlighted]')).toHaveLength(1)
  await userEvent.keyboard('{ArrowDown}')
  const keyboardCandidate = document.getElementById(
    input.element().getAttribute('aria-activedescendant')!,
  )!
  expect(keyboardCandidate).not.toBe(inactive.element())
  expect(getComputedStyle(keyboardCandidate).backgroundColor).toBe(keyboardBackground)
  expect(getComputedStyle(inactive.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  const chosen = keyboardCandidate.textContent!
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveValue('Face')
  const green = page.getByRole('radio', { name: 'app.iconPicker.color.green' })
  await green.click()
  await input.fill('Face 0')
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(1)
  await clear.click()
  await expect.element(input).toHaveValue('')
  await expect.element(input).toHaveFocus()
  await expect.element(clear).not.toBeInTheDocument()
  await expect.poll(() => page.getByRole('gridcell').all().length).toBe(unfilteredCount)
  await expect.element(green).toBeChecked()
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(page.getByRole('status', { name: 'Saved icon' })).toHaveTextContent(chosen)
  const trigger = page.getByRole('button', { name: 'Choose', exact: true })
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(input).toHaveValue('')
  await page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect.element(page.getByRole('status', { name: 'Saved icon' })).toHaveTextContent(chosen)
  await trigger.click()
  await expect
    .element(page.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    .toBeChecked()
  client.clear()
})

it('focuses the visible image action when reopening an existing image icon', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  await render(
    <QueryClientProvider client={client}>
      <IconPickerDialog
        open
        defaultValue={{
          type: 'image',
          fileId: 'image-id',
          url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        }}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />
    </QueryClientProvider>,
  )
  await expect
    .element(page.getByRole('tab', { name: 'app.iconPicker.image' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(page.getByRole('button', { name: 'common.operation.change' })).toHaveFocus()
  client.clear()
})

it.each(['light', 'dark'])(
  'distinguishes keyboard focus from the selected color in %s mode',
  async (theme) => {
    document.documentElement.dataset.theme = theme
    const client = new QueryClient()
    client.setQueryData(emojiCatalogOptions.queryKey, [])
    try {
      await render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      )
      await page.getByRole('button', { name: 'Choose', exact: true }).click()
      const red = page.getByRole('radio', { name: 'app.iconPicker.color.red' })
      const rose = page.getByRole('radio', { name: 'app.iconPicker.color.rose' })
      await expect.element(red).toBeChecked()
      expect(getComputedStyle(red.element()).outlineStyle).toBe('none')

      await userEvent.tab()
      await expect.element(red).toHaveFocus()
      expect(getComputedStyle(red.element()).outlineStyle).toBe('solid')
      expect(Number.parseFloat(getComputedStyle(red.element()).outlineWidth)).toBeGreaterThan(0)

      await userEvent.keyboard('{ArrowRight}')
      await expect.element(rose).toHaveFocus()
      await expect.element(rose).toBeChecked()
      expect(getComputedStyle(rose.element()).outlineStyle).toBe('solid')
      expect(getComputedStyle(red.element()).outlineStyle).toBe('none')

      await userEvent.tab()
      await expect
        .element(page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }))
        .toHaveFocus()
      await expect.element(rose).toBeChecked()
      expect(getComputedStyle(rose.element()).outlineStyle).toBe('none')
    } finally {
      document.documentElement.dataset.theme = 'light'
      client.clear()
    }
  },
)

it('discards the cancelled draft when reopened immediately from the keyboard', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  await render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Choose', exact: true }).click()
  await page.getByRole('radio', { name: 'app.iconPicker.color.green' }).click()
  await userEvent.keyboard('{Escape}{Enter}')
  await expect.element(page.getByRole('dialog', { name: 'app.iconPicker.title' })).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'app.iconPicker.color.red' })).toBeChecked()
  client.clear()
})

it('reveals random recommendations after scrolling or searching without moving button focus', async () => {
  const client = new QueryClient()
  client.setQueryData(
    emojiCatalogOptions.queryKey,
    Array.from({ length: 8 }, (_, group) => ({
      id: `faces-${group}`,
      label: `Faces ${group}`,
      items: emojis.map((emoji, index) => ({ emoji, label: `Face ${index}`, version: 1 })),
    })),
  )
  await render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'Choose', exact: true }).click()
  const grid = page.getByRole('grid', { name: 'app.iconPicker.emoji' })
  const input = page.getByRole('combobox', { name: 'app.iconPicker.search' })
  const random = page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' })
  const recommendation = page.getByRole('rowgroup', { name: 'app.iconPicker.recommend' })
  const target = recommendation.getByRole('gridcell', { name: 'Face 1', exact: true })
  const scroller = grid.element()
  scroller.scrollTo({ top: scroller.scrollHeight })
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(300)
  const position = scroller.scrollTop
  await page
    .getByRole('rowgroup', { name: 'Faces 7' })
    .getByRole('gridcell', { name: 'Face 19', exact: true })
    .click()
  expect(scroller.scrollTop).toBe(position)

  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    await random.click()
    await expect.element(random).toHaveFocus()
    await expect
      .poll(() => target.element().getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(scroller.getBoundingClientRect().top + 24)
    expect(target.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom,
    )
    expect(scroller.scrollTop).toBeLessThan(position)

    await input.fill('Face 19')
    await expect.element(recommendation).not.toBeInTheDocument()
    const clearedFrames: boolean[] = []
    let frameId: number
    const observeFrame = () => {
      if ((input.element() as HTMLInputElement).value === '') {
        const candidate = recommendation
          .getByRole('gridcell', { name: 'Face 4', exact: true })
          .all()[0]
        const bounds = candidate?.element().getBoundingClientRect()
        const viewport = scroller.getBoundingClientRect()
        clearedFrames.push(
          !!bounds && bounds.top >= viewport.top + 24 && bounds.bottom <= viewport.bottom,
        )
      }
      frameId = requestAnimationFrame(observeFrame)
    }
    frameId = requestAnimationFrame(observeFrame)
    try {
      await random.click()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    } finally {
      cancelAnimationFrame(frameId)
    }
    expect(clearedFrames.length).toBeGreaterThan(0)
    expect(clearedFrames.every(Boolean)).toBe(true)
    await expect.element(input).toHaveValue('')
    await expect.element(random).toHaveFocus()
    await expect.element(recommendation).toBeInTheDocument()
    const next = recommendation.getByRole('gridcell', { name: 'Face 4', exact: true })
    await expect
      .poll(() => next.element().getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(scroller.getBoundingClientRect().top + 24)
    expect(next.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom,
    )
    await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
    await expect.element(page.getByRole('status', { name: 'Saved icon' })).toHaveTextContent('😆')
  } finally {
    randomSpy.mockRestore()
    client.clear()
  }
})

it('keeps the random result visible when the first selection reveals the style panel', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: recommendedEmojis.map((emoji, index) => ({
        emoji,
        label: `Face ${index}`,
        version: 1,
      })),
    },
  ])
  await render(
    <QueryClientProvider client={client}>
      <IconPickerDialog open onOpenChange={() => {}} onConfirm={() => {}} />
    </QueryClientProvider>,
  )
  await expect.element(page.getByRole('radiogroup')).not.toBeInTheDocument()
  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
  try {
    const random = page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' })
    await random.click()
    await expect.element(page.getByRole('radiogroup')).toBeVisible()
    const target = page
      .getByRole('rowgroup', { name: 'app.iconPicker.recommend' })
      .getByRole('gridcell', { name: 'Face 24' })
    const grid = page.getByRole('grid', { name: 'app.iconPicker.emoji' })
    await expect
      .poll(() => target.element().getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(grid.element().getBoundingClientRect().bottom)
    await expect.element(random).toHaveFocus()
  } finally {
    randomSpy.mockRestore()
    client.clear()
  }
})

it('marks only the chosen occurrence across recent, recommended, and search results', async () => {
  const client = new QueryClient()
  client.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: emojis.map((emoji, index) => ({ emoji, label: `Face ${index}`, version: 1 })),
    },
  ])
  await render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  const trigger = page.getByRole('button', { name: 'Choose', exact: true })
  await trigger.click()
  const recommended = page.getByRole('rowgroup', { name: 'app.iconPicker.recommend' })
  const recommendedFace = recommended.getByRole('gridcell', { name: 'Face 1', exact: true })
  const unselectedShadow = getComputedStyle(recommendedFace.element()).boxShadow
  const markedCells = () =>
    page
      .getByRole('gridcell')
      .all()
      .map((cell) => cell.element())
      .filter((cell) => getComputedStyle(cell).boxShadow !== unselectedShadow)

  await recommendedFace.click()
  expect(markedCells()).toEqual([recommendedFace.element()])
  await page.getByRole('button', { name: 'app.iconPicker.ok' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await trigger.click()

  const recentFace = page
    .getByRole('rowgroup', { name: 'app.iconPicker.recent' })
    .getByRole('gridcell', { name: 'Face 1', exact: true })
  const categoryFace = page
    .getByRole('rowgroup', { name: 'Faces' })
    .getByRole('gridcell', { name: 'Face 1', exact: true })
  expect(page.getByRole('gridcell', { name: 'Face 1', exact: true }).all()).toHaveLength(3)
  expect(markedCells()).toEqual([recentFace.element()])
  await recommendedFace.click()
  expect(markedCells()).toEqual([recommendedFace.element()])
  await recentFace.click()
  expect(markedCells()).toEqual([recentFace.element()])

  const input = page.getByRole('combobox', { name: 'app.iconPicker.search' })
  await input.fill('Face 1')
  await expect.element(recentFace).not.toBeInTheDocument()
  expect(markedCells()).toEqual([])
  await expect.element(input).toHaveAttribute('aria-activedescendant', categoryFace.element().id)
  await userEvent.keyboard('{Enter}')
  expect(markedCells()).toEqual([categoryFace.element()])
  await page.getByRole('button', { name: 'app.iconPicker.clearSearch' }).click()
  expect(markedCells()).toEqual([categoryFace.element()])

  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    await page.getByRole('button', { name: 'app.iconPicker.tryYourLuck' }).click()
    const randomFace = recommended.getByRole('gridcell', { name: 'Face 4', exact: true })
    expect(markedCells()).toEqual([randomFace.element()])
  } finally {
    randomSpy.mockRestore()
    client.clear()
  }
})
