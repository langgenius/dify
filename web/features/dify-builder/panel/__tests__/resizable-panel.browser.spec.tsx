import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ResizableBuilderPanel } from '../resizable-panel'

function Editor({ showPanel }: { showPanel: boolean }) {
  return (
    <div className="flex h-80 w-[min(100%,980px)] justify-end">
      {showPanel && (
        <ResizableBuilderPanel label="App Builder">Builder contents</ResizableBuilderPanel>
      )}
    </div>
  )
}

it('resizes App Builder in both directions and restores the width when reopened', async () => {
  await page.viewport(1100, 640)
  window.localStorage.removeItem('dify-builder-panel-width')
  const screen = await render(<Editor showPanel />)
  const panel = screen.getByRole('complementary', { name: 'App Builder' })
  const handle = screen.getByRole('separator', { name: 'App Builder' })
  await expect.element(handle).toBeVisible()

  const resize = async (offset: number) => {
    const bounds = handle.element().getBoundingClientRect()
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await userEvent.pointer([
      { coords: { x, y }, keys: '[MouseLeft>]' },
      { coords: { x: x + offset, y } },
      '[/MouseLeft]',
    ])
  }
  const width = () => panel.element().getBoundingClientRect().width
  const original = width()
  await resize(-96)
  await expect.poll(width).toBe(original + 96)
  await resize(48)
  await expect.poll(width).toBe(original + 48)

  await screen.rerender(<Editor showPanel={false} />)
  await expect.element(panel).not.toBeInTheDocument()
  await screen.rerender(<Editor showPanel />)
  await expect.poll(width).toBe(original + 48)
  window.localStorage.removeItem('dify-builder-panel-width')
})
