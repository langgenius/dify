import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { BodyPayloadValueType, BodyType } from '../../types'
import { CurlImportDialog } from '../curl-import-dialog'
import * as curlParser from '../curl-parser'

const { mockHandleNodeSelect, mockToastError } = vi.hoisted(() => ({
  mockHandleNodeSelect: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('../../../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodeSelect: mockHandleNodeSelect,
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: {
    error: mockToastError,
  },
}))

describe('CurlImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseCurl', () => {
    it('should parse method, headers, json body, and query params from a valid curl command', () => {
      const { node, error } = curlParser.parseCurl(
        'curl -X POST -H "Authorization: Bearer token" --json "{"name":"openai"}" https://example.com/users?page=1&size=2',
      )

      expect(error).toBeNull()
      expect(node).toMatchObject({
        method: 'post',
        url: 'https://example.com/users',
        headers: 'Authorization: Bearer token',
        params: 'page: 1\nsize: 2',
      })
    })

    it('should return an error for invalid curl input', () => {
      expect(curlParser.parseCurl('fetch https://example.com').error).toContain(
        'Invalid cURL command',
      )
    })

    it('should parse form data and attach typed content headers', () => {
      const { node, error } = curlParser.parseCurl(
        'curl --request POST --form "file=@report.txt;type=text/plain" --form "name=openai" https://example.com/upload',
      )

      expect(error).toBeNull()
      expect(node).toMatchObject({
        method: 'post',
        url: 'https://example.com/upload',
        headers: 'Content-Type: text/plain',
        body: {
          type: BodyType.formData,
          data: 'file:@report.txt\nname:openai',
        },
      })
    })

    it('should parse raw payloads and preserve equals signs in the body value', () => {
      const { node, error } = curlParser.parseCurl(
        'curl --data-binary "token=abc=123" https://example.com/raw',
      )

      expect(error).toBeNull()
      expect(node?.body).toEqual({
        type: BodyType.rawText,
        data: [
          {
            type: BodyPayloadValueType.text,
            value: 'token=abc=123',
          },
        ],
      })
    })

    it.each([
      ['curl -X', 'Missing HTTP method after -X or --request.'],
      ['curl --header', 'Missing header value after -H or --header.'],
      ['curl --data-raw', 'Missing data value after -d, --data, --data-raw, or --data-binary.'],
      ['curl --form', 'Missing form data after -F or --form.'],
      ['curl --json', 'Missing JSON data after --json.'],
      ['curl --form "=broken" https://example.com/upload', 'Invalid form data format.'],
      ['curl -H "Accept: application/json"', 'Missing URL or url not start with http.'],
    ])('should return a descriptive error for %s', (command, expectedError) => {
      expect(curlParser.parseCurl(command)).toEqual({
        node: null,
        error: expectedError,
      })
    })
  })

  describe('dialog sessions', () => {
    const triggerName = 'workflowIntegrations.nodes.http.curl.title'

    it('imports the parsed request, closes, and reselects its node', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()
      render(<CurlImportDialog nodeId="node-1" readOnly={false} onImport={onImport} />)
      await user.click(screen.getByRole('button', { name: triggerName }))
      await user.type(screen.getByRole('textbox'), 'curl https://example.com')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onImport).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'get', url: 'https://example.com' }),
      )
      expect(mockHandleNodeSelect).toHaveBeenNthCalledWith(1, 'node-1', true)
      await waitFor(() => expect(mockHandleNodeSelect).toHaveBeenNthCalledWith(2, 'node-1'))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it.each(['Cancel', 'Escape'])(
      'discards the draft after %s and opens a fresh form',
      async (dismissal) => {
        const user = userEvent.setup()
        const onImport = vi.fn()
        render(<CurlImportDialog nodeId="node-1" readOnly={false} onImport={onImport} />)
        const trigger = screen.getByRole('button', { name: triggerName })
        await user.click(trigger)
        await user.type(screen.getByRole('textbox'), 'curl https://example.com')
        if (dismissal === 'Cancel')
          await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
        else await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await user.click(trigger)
        expect(screen.getByRole('textbox')).toHaveValue('')
        expect(onImport).not.toHaveBeenCalled()
        expect(mockHandleNodeSelect).not.toHaveBeenCalled()
      },
    )

    it('keeps invalid input available for correction without importing', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()
      render(<CurlImportDialog nodeId="node-1" readOnly={false} onImport={onImport} />)
      await user.click(screen.getByRole('button', { name: triggerName }))
      await user.type(screen.getByRole('textbox'), 'invalid')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining('Invalid cURL command'),
      )
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toHaveValue('invalid')
      expect(onImport).not.toHaveBeenCalled()
      expect(mockHandleNodeSelect).not.toHaveBeenCalled()
    })

    it('keeps the form open when parsing returns no node and no error', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()
      vi.spyOn(curlParser, 'parseCurl').mockReturnValueOnce({ node: null, error: null })
      render(<CurlImportDialog nodeId="node-1" readOnly={false} onImport={onImport} />)
      await user.click(screen.getByRole('button', { name: triggerName }))
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(onImport).not.toHaveBeenCalled()
      expect(mockHandleNodeSelect).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
    })

    it('offers no editor while read-only and ends an open session when permission changes', async () => {
      const user = userEvent.setup()
      const onImport = vi.fn()
      const { rerender } = render(<CurlImportDialog nodeId="node-1" readOnly onImport={onImport} />)
      expect(screen.getByText(triggerName)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: triggerName })).not.toBeInTheDocument()
      rerender(<CurlImportDialog nodeId="node-1" readOnly={false} onImport={onImport} />)
      await user.click(screen.getByRole('button', { name: triggerName }))
      await user.type(screen.getByRole('textbox'), 'curl https://example.com')
      rerender(<CurlImportDialog nodeId="node-1" readOnly onImport={onImport} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      rerender(<CurlImportDialog nodeId="node-1" readOnly={false} onImport={onImport} />)
      await user.click(screen.getByRole('button', { name: triggerName }))
      expect(screen.getByRole('textbox')).toHaveValue('')
      expect(onImport).not.toHaveBeenCalled()
    })
  })
})
