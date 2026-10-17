import type { DocExtractorNodeType } from '@/app/components/workflow/nodes/document-extractor/types'
import type { PanelProps } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import FileUploader from '@/app/components/datasets/create/file-uploader'
import Panel from '@/app/components/workflow/nodes/document-extractor/panel'
import useConfig from '@/app/components/workflow/nodes/document-extractor/use-config'
import { BlockEnum } from '@/app/components/workflow/types'
import { LanguagesSupported } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'

let mockLocale = 'en-US'
const request = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => mockLocale,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => null,
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-help-link', () => ({
  useNodeHelpLink: () => 'https://docs.example.com/document-extractor',
}))

vi.mock('@/app/components/workflow/nodes/document-extractor/use-config', () => ({
  default: vi.fn(),
}))

const createData = (): DocExtractorNodeType => ({
  title: 'Document Extractor',
  desc: '',
  type: BlockEnum.DocExtractor,
  variable_selector: ['node-1', 'files'],
  is_array_file: false,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLocale = 'en-US'
  vi.mocked(useConfig).mockReturnValue({
    readOnly: false,
    inputs: createData(),
    handleVarChanges: vi.fn(),
    filterVar: () => true,
  })
})

describe('file supported formats across upload and document extraction', () => {
  it('shares the raw supported-formats response with the uploader across locale changes', async () => {
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(
      consoleQuery.files.upload.get.queryKey(),
      createFileUploadConfigFixture({ file_upload_limit: 10 }),
    )
    const response = { allowed_extensions: ['PDF', 'pdf', 'md', 'md', 'DOCX', 'docx'] }
    request.mockImplementation(async () => Response.json(response))
    const consumers = () => (
      <>
        <FileUploader
          fileList={[]}
          prepareFileList={vi.fn()}
          onFileUpdate={vi.fn()}
          onPreview={vi.fn()}
        />
        <Panel id="doc-node" data={createData()} panelProps={panelProps} />
      </>
    )
    const { container, rerender } = renderWithConsoleQuery(consumers(), {
      queryClient,
      systemFeatures: { deployment_edition: 'CLOUD' },
    })

    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', '')
    expect(
      screen.queryByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
    ).not.toBeInTheDocument()

    await screen.findByText(
      'workflow.nodes.docExtractor.supportFileTypes:{"types":"pdf, markdown, docx"}',
    )
    expect(container.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      '.PDF,.pdf,.md,.md,.DOCX,.docx',
    )
    expect(
      screen.getByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/"supportTypes":"PDF, MARKDOWN, DOCX"/)).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    expect(new URL(request.mock.calls[0]![0]).pathname).toBe('/console/api/files/support-type')
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        fetchCompat: true,
        request: expect.objectContaining({ method: 'GET' }),
        silent: undefined,
      }),
    )

    mockLocale = LanguagesSupported[1]!
    rerender(consumers())

    await waitFor(() =>
      expect(
        screen.getByText(
          'workflow.nodes.docExtractor.supportFileTypes:{"types":"pdf、 markdown、 docx"}',
        ),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText(/"supportTypes":"PDF、 MARKDOWN、 DOCX"/)).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    expect(
      queryClient.getQueryData(consoleQuery.files.supportType.get.queryOptions().queryKey),
    ).toEqual(response)
  })
})
