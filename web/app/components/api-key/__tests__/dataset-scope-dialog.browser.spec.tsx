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

    const search = screen.getByRole('combobox', {
      name: 'appApi.apiKeyModal.searchKnowledgeBases',
    })
    const last = screen.getByRole('option', { name: 'Knowledge base 20', exact: true })
    const popup = search.element().closest('[role="dialog"]')!
    await expect.element(search).toHaveFocus()
    expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(last.element().getBoundingClientRect().bottom).toBeGreaterThan(
      popup.getBoundingClientRect().bottom,
    )

    await userEvent.keyboard('{ArrowDown}'.repeat(20))
    await expect
      .poll(() => last.element().getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(popup.getBoundingClientRect().bottom)
    expect(last.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      search.element().getBoundingClientRect().bottom,
    )
    expect(search.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      popup.getBoundingClientRect().top,
    )

    await userEvent.keyboard('{Enter}')
    await expect.element(last).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Escape}')
    await screen.getByRole('button', { name: 'common.operation.create' }).click()
    expect(onConfirm).toHaveBeenCalledWith(['dataset-20'])
  } finally {
    await page.viewport(1280, 720)
  }
})
