import type { Resources } from './index'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentDownload } from '@/service/knowledge/use-document'

import { downloadUrl } from '@/utils/download'
import Popup from './popup'

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentDownload: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/app/components/base/file-icon', () => ({
  default: ({ type }: { type: string }) => <div data-testid="file-icon" data-type={type} />,
}))

vi.mock('./progress-tooltip', () => ({
  default: ({ data }: { data: number }) => <div data-testid="progress-tooltip">{data}</div>,
}))

vi.mock('./tooltip', () => ({
  default: ({ text, data }: { text: string, data: number | string }) => (
    <div data-testid="citation-tooltip" data-text={text}>{data}</div>
  ),
}))

const mockDownloadDocument = vi.fn()
const mockUseDocumentDownload = vi.mocked(useDocumentDownload)
const mockDownloadUrl = vi.mocked(downloadUrl)

const makeSource = (overrides: Partial<Resources['sources'][number]> = {}): Resources['sources'][number] => ({
  dataset_id: 'ds-1',
  dataset_name: 'Test Dataset',
  document_id: 'doc-1',
  segment_id: 'seg-1',
  segment_position: 1,
  content: 'Source content here',
  word_count: 120,
  hit_count: 3,
  index_node_hash: 'abcdef1234567',
  score: 0.85,
  data_source_type: 'upload_file',
  document_name: 'test.pdf',
  ...overrides,
} as Resources['sources'][number])

const makeData = (overrides: Partial<Resources> = {}): Resources => ({
  documentId: 'doc-1',
  documentName: 'report.pdf',
  dataSourceType: 'upload_file',
  sources: [makeSource()],
  ...overrides,
})

const openPopup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByTestId('popup-trigger'))
}

describe('Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDocumentDownload.mockReturnValue({
      mutateAsync: mockDownloadDocument,
      isPending: false,
    } as unknown as ReturnType<typeof useDocumentDownload>)
  })

  describe('Rendering – Trigger', () => {
    it('should render the trigger element', () => {
      render(<Popup data={makeData()} />)
      expect(screen.getByTestId('popup-trigger')).toBeInTheDocument()
    })

    it('should show the document name in the trigger', () => {
      render(<Popup data={makeData({ documentName: 'My Report.pdf' })} />)
      expect(screen.getByTestId('popup-trigger')).toHaveTextContent('My Report.pdf')
    })

    it('should pass the extracted file extension to FileIcon for non-notion sources', () => {
      render(<Popup data={makeData({ documentName: 'report.pdf', dataSourceType: 'upload_file' })} />)
      expect(screen.getAllByTestId('file-icon')[0]).toHaveAttribute('data-type', 'pdf')
    })

    it('should pass notion as fileType to FileIcon for notion sources', () => {
      render(<Popup data={makeData({ documentName: 'Notion Page', dataSourceType: 'notion' })} />)
      expect(screen.getAllByTestId('file-icon')[0]).toHaveAttribute('data-type', 'notion')
    })

    it('should pass empty string as fileType when document has no extension', () => {
      render(<Popup data={makeData({ documentName: 'nodotfile', dataSourceType: 'upload_file' })} />)
      expect(screen.getAllByTestId('file-icon')[0]).toHaveAttribute('data-type', '')
    })

    it('should not render popup content before trigger is clicked', () => {
      render(<Popup data={makeData()} />)
      expect(screen.queryByTestId('popup-content')).not.toBeInTheDocument()
    })
  })

  describe('Popup Open / Close', () => {
    it('should open the popup content on trigger click', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData()} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-content')).toBeInTheDocument()
    })

    it('should close the popup on second trigger click', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData()} />)

      await openPopup(user)
      await openPopup(user)

      expect(screen.queryByTestId('popup-content')).not.toBeInTheDocument()
    })

    it('should re-open popup after open → close → open cycle', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData()} />)

      await openPopup(user)
      await openPopup(user)
      await openPopup(user)

      expect(screen.getByTestId('popup-content')).toBeInTheDocument()
    })
  })

  describe('Popup Header – Download Button', () => {
    it('should render download button in header for upload_file dataSourceType with dataset_id', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ dataSourceType: 'upload_file' })} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-download-btn')).toBeInTheDocument()
    })

    it('should render download button in header for file dataSourceType with dataset_id', async () => {
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          dataSourceType: 'file',
          sources: [makeSource({ data_source_type: 'file', dataset_id: 'ds-1' })],
        })}
        />,
      )

      await openPopup(user)

      expect(screen.getByTestId('popup-download-btn')).toBeInTheDocument()
    })

    it('should render plain document name in header (no button) for notion type', async () => {
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          documentName: 'Notion Doc',
          dataSourceType: 'notion',
          sources: [makeSource({ dataset_id: 'ds-1' })],
        })}
        />,
      )

      await openPopup(user)

      expect(screen.queryByTestId('popup-download-btn')).not.toBeInTheDocument()
    })

    it('should render plain document name in header when dataset_id is absent', async () => {
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          dataSourceType: 'upload_file',
          sources: [makeSource({ dataset_id: '' })],
        })}
        />,
      )

      await openPopup(user)

      expect(screen.queryByTestId('popup-download-btn')).not.toBeInTheDocument()
    })

    it('should disable the download button while isDownloading is true', async () => {
      mockUseDocumentDownload.mockReturnValue({
        mutateAsync: mockDownloadDocument,
        isPending: true,
      } as unknown as ReturnType<typeof useDocumentDownload>)
      const user = userEvent.setup()
      render(<Popup data={makeData()} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-download-btn')).toBeDisabled()
    })
  })

  describe('Source Items', () => {
    it('should render one source item per source entry', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource(), makeSource({ segment_id: 'seg-2' })] })} />)

      await openPopup(user)

      expect(screen.getAllByTestId('popup-source-item')).toHaveLength(2)
    })

    it('should render source content text', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ content: 'Unique content text' })] })} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-source-content')).toHaveTextContent('Unique content text')
    })

    it('should show segment_position when it is truthy', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ segment_position: 7 })] })} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-segment-position')).toHaveTextContent('7')
    })

    it('should fall back to index + 1 when segment_position is 0', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ segment_position: 0 })] })} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-segment-position')).toHaveTextContent('1')
    })
  })

  describe('Source Dividers', () => {
    it('should render a divider between multiple sources', async () => {
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          sources: [makeSource(), makeSource({ segment_id: 'seg-2' }), makeSource({ segment_id: 'seg-3' })],
        })}
        />,
      )

      await openPopup(user)

      expect(screen.getAllByTestId('popup-source-divider')).toHaveLength(2)
    })

    it('should not render any divider for a single source', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource()] })} />)

      await openPopup(user)

      expect(screen.queryByTestId('popup-source-divider')).not.toBeInTheDocument()
    })

    it('should render exactly n-1 dividers for n sources', async () => {
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          sources: [
            makeSource({ segment_id: 's1' }),
            makeSource({ segment_id: 's2' }),
            makeSource({ segment_id: 's3' }),
            makeSource({ segment_id: 's4' }),
          ],
        })}
        />,
      )

      await openPopup(user)

      expect(screen.getAllByTestId('popup-source-divider')).toHaveLength(3)
    })
  })

  describe('showHitInfo=false (default)', () => {
    it('should not render the dataset link when showHitInfo is false', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData()} showHitInfo={false} />)

      await openPopup(user)

      expect(screen.queryByTestId('popup-dataset-link')).not.toBeInTheDocument()
    })

    it('should not render hit info section when showHitInfo is false', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData()} showHitInfo={false} />)

      await openPopup(user)

      expect(screen.queryByTestId('popup-hit-info')).not.toBeInTheDocument()
    })

    it('should not render Tooltip components when showHitInfo is false', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData()} showHitInfo={false} />)

      await openPopup(user)

      expect(screen.queryAllByTestId('citation-tooltip')).toHaveLength(0)
    })

    it('should not render ProgressTooltip when showHitInfo is false', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData()} showHitInfo={false} />)

      await openPopup(user)

      expect(screen.queryByTestId('progress-tooltip')).not.toBeInTheDocument()
    })
  })

  describe('showHitInfo=true', () => {
    const dataWithScore = makeData({ sources: [makeSource({ score: 0.85 })] })

    it('should render the dataset link when showHitInfo is true', async () => {
      const user = userEvent.setup()
      render(<Popup data={dataWithScore} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-dataset-link')).toBeInTheDocument()
    })

    it('should render the dataset link with correct href', async () => {
      const user = userEvent.setup()
      render(<Popup data={dataWithScore} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-dataset-link')).toHaveAttribute(
        'href',
        `/datasets/${dataWithScore.sources[0].dataset_id}/documents/${dataWithScore.sources[0].document_id}`,
      )
    })

    it('should render the linkToDataset i18n key in the link', async () => {
      const user = userEvent.setup()
      render(<Popup data={dataWithScore} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-dataset-link')).toHaveTextContent(/linkToDataset/i)
    })

    it('should render hit info section when showHitInfo is true', async () => {
      const user = userEvent.setup()
      render(<Popup data={dataWithScore} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.getByTestId('popup-hit-info')).toBeInTheDocument()
    })

    it('should render three Tooltip components (characters, hitCount, vectorHash)', async () => {
      const user = userEvent.setup()
      render(<Popup data={dataWithScore} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.getAllByTestId('citation-tooltip')).toHaveLength(3)
    })

    it('should render ProgressTooltip when source score is greater than 0', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ score: 0.9 })] })} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.getByTestId('progress-tooltip')).toBeInTheDocument()
    })

    it('should not render ProgressTooltip when source score is 0', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ score: 0 })] })} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.queryByTestId('progress-tooltip')).not.toBeInTheDocument()
    })

    it('should pass score rounded to 2 decimal places to ProgressTooltip', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ score: 0.856 })] })} showHitInfo={true} />)

      await openPopup(user)

      expect(screen.getByTestId('progress-tooltip')).toHaveTextContent('0.86')
    })

    it('should pass word_count to the characters Tooltip', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ word_count: 250 })] })} showHitInfo={true} />)

      await openPopup(user)

      const tooltips = screen.getAllByTestId('citation-tooltip')
      expect(tooltips[0]).toHaveTextContent('250')
    })

    it('should pass hit_count to the hitCount Tooltip', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ hit_count: 7 })] })} showHitInfo={true} />)

      await openPopup(user)

      const tooltips = screen.getAllByTestId('citation-tooltip')
      expect(tooltips[1]).toHaveTextContent('7')
    })

    it('should pass truncated index_node_hash (first 7 chars) to vectorHash Tooltip', async () => {
      const user = userEvent.setup()
      render(<Popup data={makeData({ sources: [makeSource({ index_node_hash: 'abcdef1234567' })] })} showHitInfo={true} />)

      await openPopup(user)

      const tooltips = screen.getAllByTestId('citation-tooltip')
      expect(tooltips[2]).toHaveTextContent('abcdef1')
    })

    it('should render hit info for each source when multiple sources are present', async () => {
      const user = userEvent.setup()
      render(
        <Popup
          data={makeData({
            sources: [makeSource({ score: 0.9 }), makeSource({ segment_id: 'seg-2', score: 0.7 })],
          })}
          showHitInfo={true}
        />,
      )

      await openPopup(user)

      expect(screen.getAllByTestId('popup-hit-info')).toHaveLength(2)
    })
  })

  describe('handleDownloadUploadFile', () => {
    it('should call downloadDocument and downloadUrl on successful download', async () => {
      mockDownloadDocument.mockResolvedValue({ url: 'https://example.com/file.pdf' })
      const user = userEvent.setup()
      render(<Popup data={makeData({ dataSourceType: 'upload_file' })} />)

      await openPopup(user)
      await user.click(screen.getByTestId('popup-download-btn'))

      await waitFor(() => {
        expect(mockDownloadDocument).toHaveBeenCalledWith({ datasetId: 'ds-1', documentId: 'doc-1' })
        expect(mockDownloadUrl).toHaveBeenCalledWith({ url: 'https://example.com/file.pdf', fileName: 'report.pdf' })
      })
    })

    it('should not call downloadUrl when res.url is absent', async () => {
      mockDownloadDocument.mockResolvedValue({ url: '' })
      const user = userEvent.setup()
      render(<Popup data={makeData({ dataSourceType: 'upload_file' })} />)

      await openPopup(user)
      await user.click(screen.getByTestId('popup-download-btn'))

      await waitFor(() => expect(mockDownloadDocument).toHaveBeenCalled())
      expect(mockDownloadUrl).not.toHaveBeenCalled()
    })

    it('should not call downloadDocument when dataSourceType is not upload_file or file', async () => {
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          dataSourceType: 'notion',
          sources: [makeSource({ dataset_id: 'ds-1' })],
        })}
        />,
      )

      await openPopup(user)

      expect(screen.queryByTestId('popup-download-btn')).not.toBeInTheDocument()
      expect(mockDownloadDocument).not.toHaveBeenCalled()
    })

    it('should not call downloadDocument when isDownloading is true', async () => {
      mockUseDocumentDownload.mockReturnValue({
        mutateAsync: mockDownloadDocument,
        isPending: true,
      } as unknown as ReturnType<typeof useDocumentDownload>)
      const user = userEvent.setup()
      render(<Popup data={makeData({ dataSourceType: 'upload_file' })} />)

      await openPopup(user)
      await user.click(screen.getByTestId('popup-download-btn'))

      expect(mockDownloadDocument).not.toHaveBeenCalled()
    })

    it('should use documentId from data.documentId as priority over sources[0].document_id', async () => {
      mockDownloadDocument.mockResolvedValue({ url: 'https://example.com/file.pdf' })
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          documentId: 'primary-doc-id',
          dataSourceType: 'upload_file',
          sources: [makeSource({ document_id: 'fallback-doc-id', dataset_id: 'ds-1' })],
        })}
        />,
      )

      await openPopup(user)
      await user.click(screen.getByTestId('popup-download-btn'))

      await waitFor(() => {
        expect(mockDownloadDocument).toHaveBeenCalledWith({ datasetId: 'ds-1', documentId: 'primary-doc-id' })
      })
    })

    it('should work with file dataSourceType the same as upload_file', async () => {
      mockDownloadDocument.mockResolvedValue({ url: 'https://example.com/file.pdf' })
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          dataSourceType: 'file',
          sources: [makeSource({ data_source_type: 'file', dataset_id: 'ds-1' })],
        })}
        />,
      )

      await openPopup(user)
      await user.click(screen.getByTestId('popup-download-btn'))

      await waitFor(() => {
        expect(mockDownloadDocument).toHaveBeenCalled()
        expect(mockDownloadUrl).toHaveBeenCalled()
      })
    })

    it('should not call downloadDocument when both data.documentId and sources[0].document_id are empty', async () => {
      const user = userEvent.setup()
      render(
        <Popup data={makeData({
          documentId: '',
          dataSourceType: 'upload_file',
          sources: [makeSource({ document_id: '', dataset_id: 'ds-1' })],
        })}
        />,
      )

      await openPopup(user)
      await user.click(screen.getByTestId('popup-download-btn'))

      expect(mockDownloadDocument).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should render without crashing with minimum required props', () => {
      expect(() => render(<Popup data={makeData()} />)).not.toThrow()
    })

    it('should render without crashing with an empty sources array', () => {
      expect(() => render(<Popup data={makeData({ sources: [] })} />)).not.toThrow()
    })

    it('should render correctly when source has no score (undefined)', async () => {
      const user = userEvent.setup()
      render(
        <Popup
          data={makeData({
            sources: [makeSource({ score: undefined })],
          })}
          showHitInfo={true}
        />,
      )

      await openPopup(user)

      expect(screen.queryByTestId('progress-tooltip')).not.toBeInTheDocument()
    })

    it('should render correctly when index_node_hash is undefined', async () => {
      const user = userEvent.setup()
      render(
        <Popup
          data={makeData({
            sources: [makeSource({ index_node_hash: undefined })],
          })}
          showHitInfo={true}
        />,
      )

      await openPopup(user)

      const tooltips = screen.getAllByTestId('citation-tooltip')
      expect(tooltips[2]).toBeInTheDocument()
    })
  })
})
