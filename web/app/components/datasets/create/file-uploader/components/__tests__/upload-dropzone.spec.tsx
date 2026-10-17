import type { RefObject } from 'react'
import type { UploadDropzoneProps } from '../upload-dropzone'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import UploadDropzone from '../upload-dropzone'

const createMockRef = <T,>(): RefObject<T | null> => ({ current: null })

describe('UploadDropzone', () => {
  const defaultProps: UploadDropzoneProps = {
    dropRef: createMockRef<HTMLDivElement>(),
    dragRef: createMockRef<HTMLDivElement>(),
    fileUploaderRef: createMockRef<HTMLInputElement>(),
    dragging: false,
    supportBatchUpload: true,
    supportTypesShowNames: 'PDF, DOCX, TXT',
    fileUploadConfig: {
      file_size_limit: 15,
      batch_count_limit: 5,
      file_upload_limit: 10,
    },
    acceptTypes: ['.pdf', '.docx', '.txt'],
    onSelectFile: vi.fn(),
    onFileChange: vi.fn(),
  }

  it.each(['COMMUNITY', 'CLOUD'] as const)(
    'shows the applicable upload limits for %s',
    (edition) => {
      render(<UploadDropzone {...defaultProps} />, {
        systemFeatures: { deployment_edition: edition },
      })
      const tip = screen.getByText(/datasetCreation.stepOne.uploader.tip/)
      expect(tip).toHaveTextContent('"size":15')
      expect(tip).toHaveTextContent('"batchCount":5')
      expect(tip).toHaveTextContent('"supportTypes":"PDF, DOCX, TXT"')
      if (edition === 'CLOUD') expect(tip).toHaveTextContent('"totalCount":10')
      else expect(tip).not.toHaveTextContent('"totalCount"')
    },
  )

  it('disables browsing when no file types are allowed', () => {
    render(<UploadDropzone {...defaultProps} acceptTypes={[]} />)
    expect(
      screen.queryByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
    ).not.toBeInTheDocument()
  })

  it('forwards browsing and selected files to the upload owner', async () => {
    const user = userEvent.setup()
    const onFiles = vi.fn()
    render(
      <UploadDropzone
        {...defaultProps}
        onFileChange={(event) => onFiles(Array.from(event.target.files ?? []))}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
    )
    expect(defaultProps.onSelectFile).toHaveBeenCalledOnce()
    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
    ]
    await user.upload(document.getElementById('fileUploader') as HTMLInputElement, files)
    expect(onFiles).toHaveBeenCalledWith(files)
  })
})
