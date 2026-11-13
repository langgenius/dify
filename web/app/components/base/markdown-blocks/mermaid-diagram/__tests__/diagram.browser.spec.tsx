import {
  Drawer,
  DrawerBackdrop,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MermaidDiagram } from '..'

// Real font measurement, resize delivery and CSS inheritance are essential here:
// mount() used to raise ResizeObserver loop errors when the diagram changed height.
it('reflows a narrow diagram without resize errors and preserves its theme in the preview', async () => {
  const errors: string[] = []
  const onError = (event: ErrorEvent) => errors.push(event.message)
  window.addEventListener('error', onError)
  document.documentElement.dataset.theme = 'light'
  const source =
    'flowchart LR\n subgraph Research\n direction TB\n A[User input and knowledge retrieval] --> B[Generate answer]\n end\n C[Tool call] --> Research'
  const view = await render(
    <div style={{ width: 800 }}>
      <MermaidDiagram source={source} />
    </div>,
  )
  try {
    await expect.element(view.getByText('Generate answer')).toBeVisible()
    const label = view.getByText('Generate answer').element()
    const lightColor = getComputedStyle(label).fill
    await view.rerender(
      <div style={{ width: 320 }}>
        <MermaidDiagram source={source} />
      </div>,
    )
    await expect
      .poll(() => view.getByRole('img').element().getBoundingClientRect().width)
      .toBeLessThanOrEqual(320)
    document.documentElement.dataset.theme = 'dark'
    await expect
      .poll(() => getComputedStyle(view.getByText('Generate answer').element()).fill)
      .not.toBe(lightColor)
    const darkColor = getComputedStyle(view.getByText('Generate answer').element()).fill
    await userEvent.click(view.getByRole('button', { name: 'app.mermaid.preview' }).first())
    const dialog = page.getByRole('dialog', { name: 'Mermaid' })
    await expect.element(dialog.getByText('Generate answer')).toBeVisible()
    expect(getComputedStyle(dialog.getByText('Generate answer').element()).fill).toBe(darkColor)
    const fittedLabelWidth = dialog
      .getByText('Generate answer')
      .element()
      .getBoundingClientRect().width
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
    expect(
      dialog.getByText('Generate answer').element().getBoundingClientRect().width,
    ).toBeGreaterThan(fittedLabelWidth)
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.reset' }))
    expect(dialog.getByText('Generate answer').element().getBoundingClientRect().width).toBeCloseTo(
      fittedLabelWidth,
      1,
    )
    expect(errors).toEqual([])
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.close' }))
    await expect.element(dialog).not.toBeInTheDocument()
  } finally {
    document.documentElement.dataset.theme = 'light'
    window.removeEventListener('error', onError)
  }
})

it('contains diagrams even when source configuration requests a fixed width', async () => {
  const source =
    '---\nconfig:\n  usecase:\n    useMaxWidth: false\n---\nusecase-beta\ndirection LR\nactor Customer\nBrowse("Browse catalog")\nCustomer --> Browse'
  const view = await render(
    <div style={{ width: 320 }}>
      <MermaidDiagram source={source} />
    </div>,
  )
  await expect.element(view.getByText('Browse catalog')).toBeVisible()
  const diagram = view.getByRole('img').element()
  expect(diagram.getBoundingClientRect().width).toBeLessThanOrEqual(320)
  const controls = view.getByRole('button', { name: 'app.mermaid.preview' }).element()
  expect(controls.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    diagram.getBoundingClientRect().top,
  )
})

it('supports keyboard zoom and preserves descriptive SVG names', async () => {
  const view = await render(
    <MermaidDiagram
      source={
        'flowchart LR\n accTitle: Order processing\n accDescr: An order is validated before shipping.\n A[Order] --> B[Shipping]'
      }
    />,
  )
  const diagram = view.getByLabelText('Order processing')
  await expect.element(diagram).toBeVisible()
  await expect
    .element(diagram)
    .toHaveAccessibleDescription('An order is validated before shipping.')
  const svg = diagram.element()
  const label = view.getByText('Order', { exact: true })
  const initial = label.element().getBoundingClientRect().width
  ;(svg as SVGSVGElement).focus()
  await userEvent.keyboard('+')
  expect(label.element().getBoundingClientRect().width).toBeGreaterThan(initial)
  await userEvent.keyboard('0')
  expect(label.element().getBoundingClientRect().width).toBeCloseTo(initial, 1)
})

it('keeps zoom independent between instances and preserves it across parent and theme updates', async () => {
  const source = 'flowchart LR\n A[Stable] --> B[Diagram]'
  const view = await render(
    <div>
      <MermaidDiagram source={source} />
      <MermaidDiagram source={source} />
    </div>,
  )
  await expect.element(view.getByText('Stable').nth(1)).toBeVisible()
  const labels = view.getByText('Stable')
  const lightColor = getComputedStyle(labels.first().element()).fill
  const initial = labels.nth(1).element().getBoundingClientRect().width
  await userEvent.click(view.getByRole('button', { name: 'common.operation.zoomIn' }).first())
  expect(labels.nth(1).element().getBoundingClientRect().width).toBeCloseTo(initial, 1)
  const zoomed = labels.first().element().getBoundingClientRect().width
  expect(zoomed).toBeGreaterThan(initial)
  await view.rerender(
    <div>
      <MermaidDiagram source={source} />
      <MermaidDiagram source={source} />
    </div>,
  )
  document.documentElement.dataset.theme = 'dark'
  await expect.poll(() => getComputedStyle(labels.first().element()).fill).not.toBe(lightColor)
  expect(labels.first().element().getBoundingClientRect().width).toBeCloseTo(zoomed, 1)
  document.documentElement.dataset.theme = 'light'
})

it('preserves keyboard focus when a streaming update replaces the focused drawing', async () => {
  const view = await render(<MermaidDiagram source={'flowchart LR\n A[Before] --> B'} />)
  await expect.element(view.getByText('Before')).toBeVisible()
  const drawing = view.getByRole('img')
  const svg = drawing.element()
  ;(svg as SVGSVGElement).focus()
  await view.rerender(<MermaidDiagram source={'flowchart LR\n A[After] --> B'} />)
  await expect.element(view.getByText('After')).toBeVisible()
  await expect.element(drawing).toHaveFocus()
})

it('keeps the preview snapshot through streaming updates and reads the latest source on reopen', async () => {
  const inlineDiagram = (source: string) => (
    <section aria-label="Streaming diagram">
      <MermaidDiagram source={source} />
    </section>
  )
  const view = await render(inlineDiagram('flowchart TD\n A[Initial] --> B'))
  const inline = view.getByRole('region', { name: 'Streaming diagram', includeHidden: true })
  const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
  await expect.element(trigger).toBeEnabled()
  await userEvent.click(trigger)
  const dialog = page.getByRole('dialog', { name: 'Mermaid' })
  await expect.element(dialog.getByText('Initial')).toBeVisible()
  await view.rerender(inlineDiagram('flowchart TD\n A['))
  await expect.element(inline.getByRole('status', { includeHidden: true })).toBeInTheDocument()
  await expect.element(dialog.getByText('Initial')).toBeVisible()
  await view.rerender(inlineDiagram('flowchart TD\n A[Recovered] --> B'))
  await expect.element(dialog.getByText('Initial')).toBeVisible()
  await expect.element(inline.getByRole('status', { includeHidden: true })).not.toBeInTheDocument()
  await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
  await userEvent.click(dialog.getByRole('button', { name: 'common.operation.close' }))
  await userEvent.click(trigger)
  await expect.element(dialog.getByText('Recovered')).toBeVisible()
  const recovered = dialog.getByText('Recovered')
  const reopenedWidth = recovered.element().getBoundingClientRect().width
  await dialog.getByRole('button', { name: 'common.operation.reset' }).click()
  expect(recovered.element().getBoundingClientRect().width).toBeCloseTo(reopenedWidth, 1)
})

it('keeps a tall preview and its close button inside a narrow viewport', async () => {
  await page.viewport(320, 568)
  const source = `flowchart TD\n${Array.from({ length: 15 }, (_, index) => `N${index}[Step ${index}] --> N${index + 1}`).join('\n')}`
  const view = await render(<MermaidDiagram source={source} />)
  const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
  await expect.element(trigger).toBeEnabled()
  await userEvent.click(trigger)
  const dialog = page.getByRole('dialog', { name: 'Mermaid' })
  await expect.element(dialog.getByText('Step 0')).toBeVisible()
  for (const button of dialog.getByRole('button').elements()) {
    const rect = button.getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(320)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(568)
  }
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await userEvent.click(close)
  await expect.element(dialog).not.toBeInTheDocument()
})

it('keeps the preview canvas fixed while the first zoom step enlarges the drawing by 25 percent', async () => {
  await page.viewport(1440, 900)
  const view = await render(
    <MermaidDiagram
      source={
        'flowchart TD\n A[Start] --> B{User message?}\n B -->|Tool| C[Call web search]\n B -->|Respond| D[Compose draft]'
      }
    />,
  )
  const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
  await expect.element(trigger).toBeEnabled()
  await userEvent.click(trigger)
  const dialog = page.getByRole('dialog', { name: 'Mermaid' })
  const label = dialog.getByText('Start')
  await expect.element(label).toBeVisible()
  const svg = dialog.getByRole('img').element()
  await Promise.all(
    dialog
      .element()
      .getAnimations()
      .map((animation) => animation.finished),
  )
  const initial = svg.getBoundingClientRect()
  const initialLabel = label.element().getBoundingClientRect().width
  await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
  const enlarged = svg.getBoundingClientRect()
  expect(enlarged.width).toBeCloseTo(initial.width, 0)
  expect(enlarged.height).toBeCloseTo(initial.height, 0)
  expect(label.element().getBoundingClientRect().width / initialLabel).toBeCloseTo(1.25, 2)
  await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomOut' }))
  expect(label.element().getBoundingClientRect().width).toBeCloseTo(initialLabel, 0)
  expect(svg.getBoundingClientRect().width).toBeCloseTo(initial.width, 0)
  await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
  await userEvent.click(dialog.getByRole('button', { name: 'common.operation.reset' }))
  expect(label.element().getBoundingClientRect().width).toBeCloseTo(initialLabel, 0)
})

it('copies a complete PNG after zooming and resets the success feedback', async () => {
  let copied: Blob | undefined
  const write = vi.spyOn(navigator.clipboard, 'write').mockImplementation(async (items) => {
    copied = await items[0]!.getType('image/png')
  })
  try {
    const view = await render(<MermaidDiagram source={'flowchart TD\n A[Start] --> B[Finish]'} />)
    const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
    await expect.element(trigger).toBeEnabled()
    await userEvent.click(trigger)
    const dialog = page.getByRole('dialog', { name: 'Mermaid' })
    await expect.element(dialog.getByText('Start')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
    await userEvent.hover(dialog.getByRole('button', { name: 'common.operation.copyImage' }))
    await expect.element(page.getByText('common.operation.copyImage')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.copyImage' }))
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.imageCopied' }))
      .toBeEnabled()
    await expect.element(page.getByText('common.operation.imageCopied').last()).toBeVisible()
    expect(copied?.type).toBe('image/png')
    const bitmap = await createImageBitmap(copied!)
    expect(bitmap.width).toBeGreaterThan(50)
    expect(bitmap.height).toBeGreaterThan(50)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([255, 255, 255, 255])
    bitmap.close()
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.copyImage' }))
      .toBeEnabled()
    await expect.element(dialog.getByRole('status')).toBeEmptyDOMElement()
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.copyImage' }))
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.imageCopied' }))
      .toBeEnabled()
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.close' }))
    await expect.element(dialog).not.toBeInTheDocument()
    await userEvent.click(trigger)
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.copyImage' }))
      .toBeEnabled()
  } finally {
    write.mockRestore()
  }
})

it('announces a failed image copy and allows retrying', async () => {
  const write = vi
    .spyOn(navigator.clipboard, 'write')
    .mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
  try {
    const view = await render(<MermaidDiagram source={'flowchart TD\n A --> B'} />)
    const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
    await expect.element(trigger).toBeEnabled()
    await userEvent.click(trigger)
    const dialog = page.getByRole('dialog', { name: 'Mermaid' })
    const copy = dialog.getByRole('button', { name: 'common.operation.copyImage' })
    await expect.element(copy).toBeEnabled()
    await userEvent.click(copy)
    await expect
      .element(dialog.getByRole('status'))
      .toHaveTextContent('common.operation.imageCopyFailed')
    await expect.element(dialog.getByRole('status')).toBeVisible()
    await expect.element(copy).toBeEnabled()
    write.mockResolvedValue(undefined)
    await userEvent.click(copy)
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.imageCopied' }))
      .toBeEnabled()
  } finally {
    write.mockRestore()
  }
})

it('closes a nested preview without dismissing the log-detail drawer', async () => {
  await render(
    <Drawer defaultOpen swipeDirection="right">
      <DrawerPortal>
        <DrawerBackdrop className="bg-transparent" />
        <DrawerViewport>
          <DrawerPopup aria-label="Conversation details">
            <MermaidDiagram source={'flowchart TD\n A[Start] --> B[Finish]'} />
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>,
  )
  const parent = page.getByRole('dialog', { name: 'Conversation details' })
  const trigger = parent.getByRole('button', { name: 'app.mermaid.preview' })
  await expect.element(trigger).toBeEnabled()
  await userEvent.click(trigger)
  const preview = page.getByRole('dialog', { name: 'Mermaid' })
  await expect.element(preview.getByText('Start')).toBeVisible()
  await userEvent.click(preview.getByRole('button', { name: 'common.operation.close' }))
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(parent).toBeVisible()
  await expect.element(trigger).toHaveFocus()
})

it('switches preview action hints without leaking the inline hint into the dialog', async () => {
  const view = await render(
    <TooltipProvider delay={0} closeDelay={0}>
      <MermaidDiagram source={'flowchart LR\n A[Start] --> B[Finish]'} />
    </TooltipProvider>,
  )
  const inlineZoom = view.getByRole('button', { name: 'common.operation.zoomIn' })
  await expect.element(inlineZoom).toBeEnabled()
  await userEvent.hover(inlineZoom)
  await expect.element(page.getByText('common.operation.zoomIn')).toBeVisible()
  const preview = view.getByRole('button', { name: 'app.mermaid.preview' })
  await userEvent.click(preview)
  const dialog = page.getByRole('dialog', { name: 'Mermaid' })
  const zoomOut = dialog.getByRole('button', { name: 'common.operation.zoomOut' })
  await expect.element(zoomOut).toBeEnabled()
  await userEvent.hover(zoomOut)
  await expect.element(page.getByText('common.operation.zoomOut')).toBeVisible()
  await expect.element(page.getByText('common.operation.zoomIn')).not.toBeInTheDocument()
  const reset = dialog.getByRole('button', { name: 'common.operation.reset' })
  await userEvent.hover(reset)
  await expect.element(page.getByText('common.operation.reset')).toBeVisible()
  await expect.element(page.getByText('common.operation.zoomOut')).not.toBeInTheDocument()
  await userEvent.unhover(reset)
  await userEvent.click(zoomOut)
  await userEvent.keyboard('{Tab}')
  await expect.element(reset).toHaveFocus()
  await expect.element(page.getByText('common.operation.reset')).toBeVisible()
  await userEvent.click(dialog.getByRole('button', { name: 'common.operation.close' }))
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByText('common.operation.reset')).not.toBeInTheDocument()
  await expect.element(preview).toHaveFocus()
})

it('focuses the drawing on open and reaches the first action in one Tab', async () => {
  await page.viewport(320, 568)
  const view = await render(<MermaidDiagram source={'flowchart TD\n A[Start] --> B[Finish]'} />)
  const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
  await expect.element(trigger).toBeEnabled()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const dialog = page.getByRole('dialog', { name: 'Mermaid' })
  await expect.element(dialog.getByText('Start')).toBeVisible()
  const svg = dialog.getByRole('img').element()
  await expect.element(svg).toHaveFocus()
  await expect.element(page.getByText('common.operation.close')).not.toBeInTheDocument()
  await userEvent.keyboard('{Tab}')
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
    .toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(svg).toHaveFocus()
  const label = dialog.getByText('Start')
  const initialWidth = label.element().getBoundingClientRect().width
  await expect.element(page.getByText('common.operation.zoomIn')).not.toBeInTheDocument()
  await userEvent.keyboard('+++')
  expect(label.element().getBoundingClientRect().width).toBeGreaterThan(initialWidth)
  await expect.element(svg).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
