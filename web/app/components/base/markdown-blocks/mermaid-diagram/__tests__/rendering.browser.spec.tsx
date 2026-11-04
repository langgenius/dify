import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MermaidDiagram } from '..'

it.each([
  ['flowchart LR\n A[Start] --> B[Complete]', 'Complete'],
  ['sequenceDiagram\n Alice->>Bob: Hello', 'Hello'],
  ['mindmap\n root((Dify))\n  Knowledge', 'Knowledge'],
  ['gantt\n dateFormat YYYY-MM-DD\n section Plan\n Build :2026-10-18, 2d', 'Build'],
  ['gitGraph\n commit id: "Initial"', 'Initial'],
  ['timeline\n title Releases\n 2026 : Pele migration', 'Pele migration'],
  ['---\ntitle: Deployment\n---\nflowchart TD\n A --> B', 'Deployment'],
])('renders Mermaid syntax with the real renderer: %s', async (source, label) => {
  const view = await render(<MermaidDiagram source={source} />)
  await expect.element(view.getByText(label).first()).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'app.mermaid.preview' })).toBeEnabled()
})

it('coalesces source updates and keeps the last valid diagram through an incomplete update', async () => {
  const view = await render(<MermaidDiagram source={'flowchart LR\n A[First] --> B[Ready]'} />)
  await expect.element(view.getByText('Ready')).toBeVisible()
  await view.rerender(<MermaidDiagram source={'flowchart LR\n A['} />)
  await expect.element(view.getByRole('status')).toBeVisible()
  await expect.element(view.getByText('Ready')).toBeInTheDocument()
  await view.rerender(<MermaidDiagram source={'flowchart LR\n A[Obsolete] --> B'} />)
  await view.rerender(<MermaidDiagram source={'flowchart LR\n A[Latest] --> B'} />)
  await expect.element(view.getByText('Latest')).toBeInTheDocument()
  await expect.element(view.getByText('Obsolete')).not.toBeInTheDocument()
  await expect.element(view.getByText('Ready')).not.toBeInTheDocument()
})

it('recovers from invalid initial input and previews the last successful source', async () => {
  const view = await render(<MermaidDiagram source={'flowchart LR\n A['} />)
  await expect.element(page.getByRole('button', { name: 'app.mermaid.preview' })).toBeDisabled()
  await view.rerender(<MermaidDiagram source={'flowchart LR\n A[Recovered] --> B'} />)
  await expect.element(view.getByText('Recovered')).toBeVisible()
  await view.rerender(<MermaidDiagram source={'flowchart LR\n A['} />)
  await expect.element(view.getByRole('status')).toBeVisible()
  await userEvent.click(page.getByRole('button', { name: 'app.mermaid.preview' }))
  await expect
    .element(page.getByRole('dialog', { name: 'Mermaid' }).getByText('Recovered'))
    .toBeVisible()
  await userEvent.click(page.getByRole('button', { name: 'common.operation.close' }))
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('does not turn untrusted diagram links or HTML labels into active content', async () => {
  const view = await render(
    <MermaidDiagram
      source={
        'flowchart TD\n A["<img src=x onerror=alert(1)>"] --> B[Safe]\n click B "https://example.com"'
      }
    />,
  )
  await expect.element(view.getByText('Safe')).toBeInTheDocument()
  expect(
    view.container.querySelector('a, image, img, script, foreignObject, [onerror], [onclick]'),
  ).not.toBeInTheDocument()
})

it('rejects an oversized source without leaving an enabled preview', async () => {
  const view = await render(<MermaidDiagram source={`flowchart TD\n A[${'x'.repeat(50_000)}]`} />)
  await expect.element(view.getByText(/longer than the limit/)).toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'app.mermaid.preview' })).toBeDisabled()
})

it('blocks external image resources in diagram shapes', async () => {
  const view = await render(
    <MermaidDiagram
      source={
        'flowchart LR\n A@{ img: "https://example.com/image.png", label: "Remote image" } --> B[Safe]'
      }
    />,
  )
  await expect.element(view.getByText('Safe')).toBeInTheDocument()
  expect(view.container.querySelector('image, img')).not.toBeInTheDocument()
})
