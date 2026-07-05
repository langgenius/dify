import { render } from 'vitest-browser-react'
import {
  FileTreeFile,
  FileTreeFolder,
  FileTreeFolderPanel,
  FileTreeFolderTrigger,
  FileTreeIcon,
  FileTreeLabel,
  FileTreeList,
  FileTreeRoot,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

function TestFileTree({
  onPreview = vi.fn(),
}: {
  onPreview?: (itemId: string) => void
}) {
  return (
    <FileTreeRoot aria-label="Project files">
      <FileTreeList>
        <FileTreeFolder defaultOpen>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel>src</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <FileTreeFolder defaultOpen>
              <FileTreeFolderTrigger>
                <FileTreeIcon type="folder" />
                <FileTreeLabel>components</FileTreeLabel>
              </FileTreeFolderTrigger>
              <FileTreeFolderPanel>
                <FileTreeFile selected onClick={() => onPreview('button')}>
                  <FileTreeIcon type="code" />
                  <FileTreeLabel>button.tsx</FileTreeLabel>
                </FileTreeFile>
                <FileTreeFile onClick={() => onPreview('readme')}>
                  <FileTreeIcon type="markdown" />
                  <FileTreeLabel>README.md</FileTreeLabel>
                </FileTreeFile>
              </FileTreeFolderPanel>
            </FileTreeFolder>
            <FileTreeFile onClick={() => onPreview('index')}>
              <FileTreeIcon type="code" />
              <FileTreeLabel>index.ts</FileTreeLabel>
            </FileTreeFile>
          </FileTreeFolderPanel>
        </FileTreeFolder>
        <FileTreeFile onClick={() => onPreview('package')}>
          <FileTreeIcon type="json" />
          <FileTreeLabel>package.json</FileTreeLabel>
        </FileTreeFile>
      </FileTreeList>
    </FileTreeRoot>
  )
}

describe('FileTree', () => {
  it('renders a labelled disclosure list instead of an ARIA treeview', async () => {
    const screen = await render(<TestFileTree />)
    const root = screen.getByLabelText('Project files')
    const src = screen.getByRole('button', { name: 'src' })
    const selectedFile = screen.getByRole('button', { name: 'button.tsx' })

    await expect.element(root).not.toHaveAttribute('role', 'tree')
    await expect.element(src).toHaveAttribute('aria-expanded', 'true')
    await expect.element(src).toHaveAttribute('aria-controls')
    await expect.element(src).not.toHaveAttribute('aria-current')
    await expect.element(src).not.toHaveAttribute('data-selected')
    await expect.element(selectedFile).toHaveAttribute('aria-current', 'true')
    await expect.element(selectedFile).toHaveAttribute('data-selected')
  })

  it('collapses and expands folders with click and native button keyboard behavior', async () => {
    const screen = await render(<TestFileTree />)
    const src = screen.getByRole('button', { name: 'src' }).element() as HTMLElement

    src.click()

    await expect.element(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.container.textContent).not.toContain('components')

    src.click()

    await expect.element(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'true')
    await expect.element(screen.getByRole('button', { name: 'components' })).toBeInTheDocument()
  })

  it('activates file preview buttons without navigation semantics', async () => {
    const onPreview = vi.fn()
    const screen = await render(<TestFileTree onPreview={onPreview} />)

    asHTMLElement(screen.getByRole('button', { name: 'README.md' }).element()).click()

    expect(onPreview).toHaveBeenCalledWith('readme')
    await expect.element(screen.getByRole('button', { name: 'README.md' })).not.toHaveAttribute('href')
  })

  it('does not activate disabled file buttons', async () => {
    const onPreview = vi.fn()
    const screen = await render(
      <FileTreeRoot aria-label="Disabled files">
        <FileTreeList>
          <FileTreeFile disabled onClick={() => onPreview('disabled')}>
            <FileTreeIcon type="file" />
            <FileTreeLabel>disabled.txt</FileTreeLabel>
          </FileTreeFile>
        </FileTreeList>
      </FileTreeRoot>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'disabled.txt' }).element()).click()

    expect(onPreview).not.toHaveBeenCalled()
    await expect.element(screen.getByRole('button', { name: 'disabled.txt' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'disabled.txt' })).toHaveAttribute('data-disabled')
  })

  it('resolves disabled folder triggers through the collapsible state', async () => {
    const onOpenChange = vi.fn()
    const screen = await render(
      <FileTreeRoot aria-label="Disabled folders">
        <FileTreeList>
          <FileTreeFolder disabled defaultOpen onOpenChange={onOpenChange}>
            <FileTreeFolderTrigger>
              <FileTreeIcon type="folder" />
              <FileTreeLabel>locked</FileTreeLabel>
            </FileTreeFolderTrigger>
            <FileTreeFolderPanel>
              <FileTreeFile>
                <FileTreeIcon type="file" />
                <FileTreeLabel>nested.txt</FileTreeLabel>
              </FileTreeFile>
            </FileTreeFolderPanel>
          </FileTreeFolder>
        </FileTreeList>
      </FileTreeRoot>,
    )
    const trigger = screen.getByRole('button', { name: 'locked' })

    asHTMLElement(trigger.element()).click()

    expect(onOpenChange).not.toHaveBeenCalled()
    await expect.element(trigger).toHaveAttribute('aria-disabled', 'true')
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
