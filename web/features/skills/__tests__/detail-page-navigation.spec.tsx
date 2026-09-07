import { Dialog, DialogPopup, DialogPortal, DialogTitle } from '@langgenius/dify-ui/dialog'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import {
  createFileTabSkillDetail,
  createReferencePickerSkillDetail,
  createSkillDetail,
  getFileTabButton,
  getFileTreeButton,
  getLiveMarkdownEditor,
  getMocks,
  getReferencePicker,
  getReferencePickerButton,
  getSourceEditor,
  placeCaretAtEnd,
  preserveDraftFilesOnSave,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

function TestGotoAnythingDialog() {
  return (
    <Dialog handle={gotoAnythingDialogHandle}>
      <DialogPortal>
        <DialogPopup>
          <DialogTitle>Goto Anything</DialogTitle>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

describe('SkillDetailPage navigation', () => {
  beforeEach(resetDetailPageFixture)

  it('opens Go to Anything from the sidebar search action', async () => {
    renderSkillDetailPage()
    render(<TestGotoAnythingDialog />)

    expect(screen.queryByRole('dialog', { name: 'Goto Anything' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(screen.getByRole('dialog', { name: 'Goto Anything' })).toBeInTheDocument()
  })

  it('collapses and expands the file tree sidebar', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.collapseSidebar',
      }),
    )
    expect(screen.queryByTestId('skill-detail-sidebar-header')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.expandSidebar',
      }),
    )
    expect(await screen.findByTestId('skill-detail-sidebar-header')).toBeInTheDocument()
  })

  it('shows the sidebar while the collapsed rail is hovered', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.collapseSidebar',
      }),
    )
    expect(screen.queryByTestId('skill-detail-sidebar-header')).not.toBeInTheDocument()

    fireEvent.mouseEnter(screen.getByTestId('skill-detail-sidebar-shell'))

    expect(await screen.findByTestId('skill-detail-sidebar-header')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.collapseSidebar',
      }),
    )

    expect(await screen.findByTestId('skill-detail-sidebar-header')).toBeInTheDocument()
  })

  it('resizes the file tree sidebar within its accessible range', async () => {
    renderSkillDetailPage()

    const resizeHandle = await screen.findByRole('separator', {
      name: 'skill.skillManagement.detail.resizeSidebar',
    })
    expect(resizeHandle).toHaveAttribute('aria-valuemin', '240')
    expect(resizeHandle).toHaveAttribute('aria-valuemax', '420')
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '240')

    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 244 })
    fireEvent.pointerMove(document, { clientX: 600 })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '420')

    fireEvent.pointerMove(document, { clientX: 0 })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '240')
    fireEvent.pointerUp(document)

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '248')
    fireEvent.keyDown(resizeHandle, { key: 'End' })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '420')
    fireEvent.keyDown(resizeHandle, { key: 'Home' })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '240')
  })

  it('navigates, filters, closes, and inserts from the source reference picker', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.click(getReferencePickerButton('docs'))
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()
    expect(getReferencePickerButton('guide.md')).toBeInTheDocument()
    await user.click(getReferencePickerButton('..'))
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)
    await user.keyboard('read')
    await waitFor(() => {
      expect(within(getReferencePicker()).getByText('read')).toBeInTheDocument()
    })
    expect(getReferencePickerButton('README.md')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(
        screen.queryByText('skill.skillManagement.detail.referenceFiles.title'),
      ).not.toBeInTheDocument()
    })

    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)
    await user.keyboard('/')
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)
    await user.keyboard('read')
    await user.click(getReferencePickerButton('README.md'))

    await waitFor(() => {
      expect(sourceEditor.value).toContain('[README.md](<README.md>)')
    })
  })

  it('navigates the source reference picker with arrow keys', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()

    await user.keyboard('{ArrowUp}')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(sourceEditor.value).toContain('[reference.md](<docs/reference.md>)')
    })
  })

  it('handles reference picker Enter and ArrowUp keyboard edge cases', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()
  })

  it('inserts a reference file from live markdown slash picker', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    const livePreview = screen
      .getAllByRole('textbox')
      .find((editor): editor is HTMLDivElement => editor instanceof HTMLDivElement)
    if (!livePreview) throw new Error('live markdown preview not found')

    await user.click(livePreview)
    const liveEditor = await waitFor(() => getLiveMarkdownEditor())
    liveEditor.focus()
    placeCaretAtEnd(liveEditor)
    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}{Enter}')

    await waitFor(() => {
      expect(liveEditor.textContent).toContain('guide.md')
    })
  })

  it('inserts a reference from the live picker by clicking through a directory', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    const livePreview = screen
      .getAllByRole('textbox')
      .find((editor): editor is HTMLDivElement => editor instanceof HTMLDivElement)
    if (!livePreview) throw new Error('live markdown preview not found')

    await user.click(livePreview)
    const liveEditor = await waitFor(() => getLiveMarkdownEditor())
    liveEditor.focus()
    placeCaretAtEnd(liveEditor)
    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.click(getReferencePickerButton('docs'))
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(
        screen.queryByText('skill.skillManagement.detail.referenceFiles.title'),
      ).not.toBeInTheDocument()
    })
  })

  it('shows the full reference path on hover and opens the referenced file in an editor tab', async () => {
    const manifestContent =
      '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n---\n# Guide\n\nRead [guide.md](<docs/guide.md>) before continuing.\n'
    mocks.skillDetail = createSkillDetail({
      files: [
        {
          ...createSkillDetail().files![0]!,
          content: manifestContent,
          size: manifestContent.length,
        },
        {
          id: 'file-2',
          path: 'docs/guide.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# Guide',
          tool_file_id: null,
          size: 7,
          hash: 'hash-2',
        },
      ],
    })

    const { container } = renderSkillDetailPage()
    const reference = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-reference-path="docs/guide.md"]')
      expect(element).toBeInTheDocument()
      return element!
    })

    expect(reference).toHaveAttribute('title', 'docs/guide.md')

    fireEvent.click(reference)
    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"docs/guide.md"}',
      }),
    ).toBeInTheDocument()
  })

  it('keeps SKILL.md open and replaces the previous temporary tab on sidebar single click', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createFileTabSkillDetail()
    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    expect(getFileTabButton('SKILL.md')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"SKILL.md"}',
      }),
    ).not.toBeInTheDocument()

    await user.click(getFileTreeButton('README.md'))
    expect(getFileTabButton('README.md')).toBeInTheDocument()

    await user.click(getFileTreeButton('prompt.md'))
    expect(
      screen.queryByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"README.md"}',
      }),
    ).not.toBeInTheDocument()
    expect(getFileTabButton('prompt.md')).toBeInTheDocument()
    expect(getFileTabButton('SKILL.md')).toBeInTheDocument()
  })

  it('pins a file tab on sidebar double click', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createFileTabSkillDetail()
    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    await user.dblClick(getFileTreeButton('README.md'))

    await user.click(getFileTreeButton('prompt.md'))
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"README.md"}',
      }),
    ).toBeInTheDocument()
    expect(getFileTabButton('prompt.md')).toBeInTheDocument()
  })

  it('promotes a temporary tab to a pinned tab when its file is edited', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createFileTabSkillDetail()
    preserveDraftFilesOnSave()
    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    await user.click(getFileTreeButton('notes.txt'))

    const notesEditor = screen
      .getAllByRole('textbox')
      .find(
        (textbox): textbox is HTMLTextAreaElement =>
          textbox instanceof HTMLTextAreaElement && textbox.value === 'Notes',
      )
    expect(notesEditor).toBeDefined()
    await user.clear(notesEditor!)
    await user.type(notesEditor!, 'Updated notes')
    await user.click(getFileTreeButton('README.md'))
    expect(getFileTabButton('notes.txt')).toBeInTheDocument()
  })
})
