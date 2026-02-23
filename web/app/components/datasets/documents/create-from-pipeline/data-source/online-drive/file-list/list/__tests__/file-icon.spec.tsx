import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OnlineDriveFileType } from '@/models/pipeline'
import FileIcon from '../file-icon'

vi.mock('@/app/components/base/file-uploader/file-type-icon', () => ({
  default: ({ type }: { type: string }) => <span data-testid="file-type-icon">{type}</span>,
}))
vi.mock('@/app/components/base/icons/src/public/knowledge/online-drive', () => ({
  BucketsBlue: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="bucket-icon" {...props} />,
  Folder: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="folder-icon" {...props} />,
}))

describe('FileIcon', () => {
  it('should render bucket icon for bucket type', () => {
    render(<FileIcon type={OnlineDriveFileType.bucket} fileName="" />)
    expect(screen.getByTestId('bucket-icon')).toBeInTheDocument()
  })

  it('should render folder icon for folder type', () => {
    render(<FileIcon type={OnlineDriveFileType.folder} fileName="" />)
    expect(screen.getByTestId('folder-icon')).toBeInTheDocument()
  })

  it('should render file type icon for file type', () => {
    render(<FileIcon type={OnlineDriveFileType.file} fileName="doc.pdf" />)
    expect(screen.getByTestId('file-type-icon')).toBeInTheDocument()
  })
})
