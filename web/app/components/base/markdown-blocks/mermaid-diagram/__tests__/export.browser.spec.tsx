import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { downloadBlob } from '@/utils/download'
import { MermaidDiagram } from '..'

vi.mock('@/utils/download', () => ({ downloadBlob: vi.fn() }))

it('downloads the complete themed drawing independently of the preview zoom and stage padding', async () => {
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
    expect(svg.getAttribute('style')).toContain('--pele-bg:')
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
