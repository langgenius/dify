import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentUploadFileList } from '../file-list'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const mock = createReactI18nextMock()

  return {
    ...mock,
    useTranslation: (namespace?: string | readonly string[]) => {
      const translation = mock.useTranslation(namespace)
      return {
        ...translation,
        i18n: { ...translation.i18n, language: 'tr-TR' },
      }
    },
  }
})

describe('DocumentUploadFileList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps technical file extensions locale independent', () => {
    const file = new File(['key=value'], 'config.properties', { type: 'text/plain' })

    render(
      <DocumentUploadFileList
        disabled={false}
        fileSizeLimitMb={10}
        items={[{ file, id: 'file-1' }]}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText(/PROPERTIES/)).toBeVisible()
    expect(screen.queryByText(/PROPERTİES/)).not.toBeInTheDocument()
  })

  it('closes a local preview through its open state', async () => {
    vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
    const user = userEvent.setup()
    const file = new File(['# Notes'], 'notes.md', { type: 'text/markdown' })

    render(
      <DocumentUploadFileList
        disabled={false}
        fileSizeLimitMb={10}
        items={[{ file, id: 'file-1' }]}
        onRemove={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    const dialog = await screen.findByRole('dialog', { name: 'notes.md' })
    expect(await within(dialog).findByLabelText('notes.md')).toHaveTextContent('# Notes')

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))

    // The root observes the close, so the popup plays its exit state before unmounting.
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('data-closed')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })
})
