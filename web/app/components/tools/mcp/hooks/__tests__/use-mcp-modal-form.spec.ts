import { isValidServerID, isValidUrl } from '../use-mcp-modal-form'

describe('MCP connection validation', () => {
  it.each([
    ['http://example.com', true],
    ['https://example.com', true],
    ['https://example.com/mcp', true],
    ['https://example.com/mcp?key=value', true],
    ['not-a-url', false],
    ['ftp://example.com', false],
    ['', false],
    ['file:///tmp/mcp', false],
  ])('validates the HTTP server URL %j', (url, valid) => {
    expect(isValidUrl(url)).toBe(valid)
  })

  it.each([
    ['myserver', true],
    ['12345', true],
    ['my-server', true],
    ['my_server', true],
    ['abcdefghijklmnopqrstuvwx', true],
    ['MyServer', false],
    ['my server', false],
    ['my@server', false],
    ['', false],
    ['abcdefghijklmnopqrstuvwxy', false],
  ])('validates the server identifier %j', (identifier, valid) => {
    expect(isValidServerID(identifier)).toBe(valid)
  })
})
