import { render, screen } from '@testing-library/react'
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
})
