import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { downloadBlob } from '@/utils/download'
import { MermaidDiagram } from '..'

vi.mock('@/utils/download', () => ({ downloadBlob: vi.fn() }))

it('downloads the complete themed drawing independently of the preview zoom', async () => {
  document.documentElement.dataset.theme = 'dark'
  try {
    const view = await render(<MermaidDiagram source={'flowchart TD\n A[Start] --> B[Finish]'} />)
    const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
    await expect.element(trigger).toBeEnabled()
    await userEvent.click(trigger)
    const dialog = page.getByRole('dialog', { name: 'Mermaid' })
    await expect.element(dialog.getByText('Finish')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.download' }))
    const { data, fileName } = vi.mocked(downloadBlob).mock.calls[0]![0]
    expect(fileName).toBe('mermaid.svg')
    expect(data.type).toBe('image/svg+xml')
    const document = new DOMParser().parseFromString(await data.text(), 'image/svg+xml')
    const svg = document.documentElement
    expect(svg.textContent).toContain('Start')
    expect(svg.textContent).toContain('Finish')
    expect(svg.getAttribute('viewBox')).toBe(
      `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`,
    )
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await data.text())}`
    await image.decode()
    expect(image.naturalWidth).toBeGreaterThan(50)
    expect(image.naturalWidth).toBeLessThan(300)
  } finally {
    document.documentElement.dataset.theme = 'light'
    vi.mocked(downloadBlob).mockClear()
  }
})

it('opens a complete drawing in an isolated tab after preview zooming', async () => {
  const target = { document: document.implementation.createHTMLDocument(), opener: window }
  const open = vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window)
  try {
    const view = await render(<MermaidDiagram source={'flowchart TD\n A[Start] --> B[Finish]'} />)
    const trigger = view.getByRole('button', { name: 'app.mermaid.preview' })
    await expect.element(trigger).toBeEnabled()
    await userEvent.click(trigger)
    const dialog = page.getByRole('dialog', { name: 'Mermaid' })
    await expect.element(dialog.getByText('Finish')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.zoomIn' }))
    await userEvent.click(dialog.getByRole('button', { name: 'common.operation.openInNewTab' }))
    expect(open).toHaveBeenCalledOnce()
    expect(target.opener).toBeNull()
    const image = target.document.querySelector('img')!
    expect(image.alt).toBe('Mermaid')
    const exported = new DOMParser().parseFromString(
      decodeURIComponent(image.src.split(',')[1]!),
      'image/svg+xml',
    ).documentElement
    expect(exported.textContent).toContain('Start')
    expect(exported.textContent).toContain('Finish')
    expect(exported.getAttribute('viewBox')).toBe(
      `0 0 ${exported.getAttribute('width')} ${exported.getAttribute('height')}`,
    )
    const loaded = new Image()
    loaded.src = image.src
    await loaded.decode()
    expect(loaded.naturalWidth).toBeGreaterThan(0)
  } finally {
    open.mockRestore()
  }
})
