import { expect } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DatasetScopeDialog } from '../dataset-scope-dialog'

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInfiniteDatasets: () => ({
    data: {
      pages: [
        {
          data: Array.from({ length: 20 }, (_, index) => ({
            id: `dataset-${index + 1}`,
            name: `Knowledge base ${index + 1}`,
          })),
        },
      ],
    },
  }),
}))

// Unit tests cannot detect clipping or prove that keyboard navigation scrolls the
// production picker. Keep the final row reachable without moving the search field.
it('scrolls a long dataset list within the picker and lets the user select its last row', async () => {
  await page.viewport(1000, 600)
  try {
    const onConfirm = vi.fn()
    const screen = await render(
      <DatasetScopeDialog open isCreating={false} onOpenChange={() => {}} onConfirm={onConfirm} />,
    )
    await screen.getByRole('radio', { name: /scopeSpecificDatasets/ }).click()
    await screen.getByRole('button', { name: 'appApi.apiKeyModal.addKnowledgeBase' }).click()

    const search = screen.getByPlaceholder('appApi.apiKeyModal.searchKnowledgeBases')
    const first = screen.getByRole('checkbox', { name: 'Knowledge base 1', exact: true })
    const last = screen.getByRole('checkbox', { name: 'Knowledge base 20', exact: true })
    const popup = search.element().closest('[role="dialog"]')!
    const searchOffset =
      search.element().getBoundingClientRect().top - popup.getBoundingClientRect().top
    expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(last.element().getBoundingClientRect().bottom).toBeGreaterThan(
      popup.getBoundingClientRect().bottom,
    )

    await first.click()
    await userEvent.keyboard(' ')
    await expect.element(first).toHaveFocus()
    await userEvent.keyboard('{Tab}'.repeat(19))
    await expect.element(last).toHaveFocus()
    await expect
      .poll(() => last.element().getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(popup.getBoundingClientRect().bottom)
    expect(last.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      search.element().getBoundingClientRect().bottom,
    )
    expect(
      search.element().getBoundingClientRect().top - popup.getBoundingClientRect().top,
    ).toBeCloseTo(searchOffset, 0)

    await userEvent.keyboard(' ')
    await expect.element(last).toBeChecked()
    await userEvent.keyboard('{Escape}')
    await screen.getByRole('button', { name: 'common.operation.create' }).click()
    expect(onConfirm).toHaveBeenCalledWith(['dataset-20'])
  } finally {
    await page.viewport(1280, 720)
  }
})
