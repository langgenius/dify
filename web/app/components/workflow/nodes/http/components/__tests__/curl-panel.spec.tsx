import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/components/base/ui/toast'
import { BodyPayloadValueType, BodyType } from '../../types'
import CurlPanel from '../curl-panel'
import * as curlParser from '../curl-parser'

const {
  mockHandleNodeSelect,
  mockToastError,
} = vi.hoisted(() => ({
  mockHandleNodeSelect: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

describe('curl-panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseCurl', () => {
    it('should parse method, headers, json body, and query params from a valid curl command', () => {
      const { node, error } = curlParser.parseCurl('curl -X POST -H \"Authorization: Bearer token\" --json \"{\"name\":\"openai\"}\" https://example.com/users?page=1&size=2')

      expect(error).toBeNull()
      expect(node).toMatchObject({
        method: 'post',
        url: 'https://example.com/users',
        headers: 'Authorization: Bearer token',
        params: 'page: 1\nsize: 2',
      })
    })

    it('should return an error for invalid curl input', () => {
      expect(curlParser.parseCurl('fetch https://example.com').error).toContain('Invalid cURL command')
    })

    it('should parse form data and attach typed content headers', () => {
      const { node, error } = curlParser.parseCurl('curl --request POST --form "file=@report.txt;type=text/plain" --form "name=openai" https://example.com/upload')

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
      const { node, error } = curlParser.parseCurl('curl --data-binary "token=abc=123" https://example.com/raw')

      expect(error).toBeNull()
      expect(node?.body).toEqual({
        type: BodyType.rawText,
        data: [{
          type: BodyPayloadValueType.text,
          value: 'token=abc=123',
        }],
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

  describe('component actions', () => {
    it('should import a parsed curl node and reselect the node after saving', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      const handleCurlImport = vi.fn()

      render(
        <CurlPanel
          nodeId="node-1"
          isShow
          onHide={onHide}
          handleCurlImport={handleCurlImport}
        />,
      )

      await user.type(screen.getByRole('textbox'), 'curl https://example.com')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onHide).toHaveBeenCalledTimes(1)
      expect(handleCurlImport).toHaveBeenCalledWith(expect.objectContaining({
        method: 'get',
        url: 'https://example.com',
      }))
      expect(mockHandleNodeSelect).toHaveBeenNthCalledWith(1, 'node-1', true)
    })

    it('should notify the user when the curl command is invalid', async () => {
      const user = userEvent.setup()

      render(
        <CurlPanel
          nodeId="node-1"
          isShow
          onHide={vi.fn()}
          handleCurlImport={vi.fn()}
        />,
      )

      await user.type(screen.getByRole('textbox'), 'invalid')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining('Invalid cURL command'))
    })

    it('should keep the panel open when parsing returns no node and no error', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      const handleCurlImport = vi.fn()
      vi.spyOn(curlParser, 'parseCurl').mockReturnValueOnce({
        node: null,
        error: null,
      })

      render(
        <CurlPanel
          nodeId="node-1"
          isShow
          onHide={onHide}
          handleCurlImport={handleCurlImport}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onHide).not.toHaveBeenCalled()
      expect(handleCurlImport).not.toHaveBeenCalled()
      expect(mockHandleNodeSelect).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
    })
  })
})
