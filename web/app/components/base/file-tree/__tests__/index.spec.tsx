import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  FileTreeFolderPanel,
  FileTreeFolderTrigger,
  FileTreeIcon,
  FileTreeLabel,
  FileTreeList,
} from '../index'

function TestFileTree({ onPreview = vi.fn() }: { onPreview?: (itemId: string) => void }) {
  return (
    <FileTree aria-label="Project files">
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
    </FileTree>
  )
}

describe('FileTree', () => {
  it('renders a labelled disclosure list instead of an ARIA treeview', () => {
    render(<TestFileTree />)
    const root = screen.getByLabelText('Project files')
    const src = screen.getByRole('button', { name: 'src' })
    const selectedFile = screen.getByRole('button', { name: 'button.tsx' })

    expect(root).not.toHaveAttribute('role', 'tree')
    expect(src).toHaveAttribute('aria-expanded', 'true')
    expect(src).toHaveAttribute('aria-controls')
    expect(src).not.toHaveAttribute('aria-current')
    expect(src).not.toHaveAttribute('data-selected')
    expect(selectedFile).toHaveAttribute('aria-current', 'true')
    expect(selectedFile).toHaveAttribute('data-selected')
  })

  it('activates file preview buttons without navigation semantics', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    render(<TestFileTree onPreview={onPreview} />)

    await user.click(screen.getByRole('button', { name: 'README.md' }))

    expect(onPreview).toHaveBeenCalledWith('readme')
    expect(screen.getByRole('button', { name: 'README.md' })).not.toHaveAttribute('href')
  })

  it('does not activate disabled file buttons', () => {
    render(
      <FileTree aria-label="Disabled files">
        <FileTreeList>
          <FileTreeFile disabled>
            <FileTreeIcon type="file" />
            <FileTreeLabel>disabled.txt</FileTreeLabel>
          </FileTreeFile>
        </FileTreeList>
      </FileTree>,
    )

    expect(screen.getByRole('button', { name: 'disabled.txt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'disabled.txt' })).toHaveAttribute('data-disabled')
  })

  it('resolves disabled folder triggers through the collapsible state', () => {
    render(
      <FileTree aria-label="Disabled folders">
        <FileTreeList>
          <FileTreeFolder disabled defaultOpen>
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
      </FileTree>,
    )
    const trigger = screen.getByRole('button', { name: 'locked' })

    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
