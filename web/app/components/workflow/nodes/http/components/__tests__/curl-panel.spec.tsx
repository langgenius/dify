import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CurlPanel from '../curl-panel'
import { parseCurl } from '../curl-parser'

const {
  mockHandleNodeSelect,
  mockNotify,
} = vi.hoisted(() => ({
  mockHandleNodeSelect: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mockNotify,
  },
}))

describe('curl-panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseCurl', () => {
    it('should parse method, headers, json body, and query params from a valid curl command', () => {
      const { node, error } = parseCurl('curl -X POST -H \"Authorization: Bearer token\" --json \"{\"name\":\"openai\"}\" https://example.com/users?page=1&size=2')

      expect(error).toBeNull()
      expect(node).toMatchObject({
        method: 'post',
        url: 'https://example.com/users',
        headers: 'Authorization: Bearer token',
        params: 'page: 1\nsize: 2',
      })
    })

    it('should return an error for invalid curl input', () => {
      expect(parseCurl('fetch https://example.com').error).toContain('Invalid cURL command')
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

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
      }))
    })
  })
})
