/**
 * XSS Prevention Test Suite
 *
 * This test verifies that the XSS vulnerabilities in block-input and support-var-input
 * components have been properly fixed by replacing dangerouslySetInnerHTML with safe React rendering.
 */

import { cleanup, render } from '@testing-library/react'
import * as React from 'react'
import BlockInput from '../app/components/base/block-input'
import SupportVarInput from '../app/components/workflow/nodes/_base/components/support-var-input'

// Mock styles
vi.mock('../app/components/app/configuration/base/var-highlight/style.module.css', () => ({
  default: {
    item: 'mock-item-class',
  },
}))

describe('XSS Prevention - Block Input and Support Var Input Security', () => {
  afterEach(() => {
    cleanup()
  })

  describe('BlockInput Component Security', () => {
    it('should safely render malicious variable names without executing scripts', () => {
      const testInput = 'user@test.com{{<script>alert("XSS")</script>}}'
      const { container } = render(<BlockInput value={testInput} readonly={true} />)

      const scriptElements = container.querySelectorAll('script')
      expect(scriptElements).toHaveLength(0)

      const textContent = container.textContent
      expect(textContent).toContain('<script>')
    })

    it('should preserve legitimate variable highlighting', () => {
      const legitimateInput = 'Hello {{userName}} welcome to {{appName}}'
      const { container } = render(<BlockInput value={legitimateInput} readonly={true} />)

      const textContent = container.textContent
      expect(textContent).toContain('userName')
      expect(textContent).toContain('appName')
    })
  })

  describe('SupportVarInput Component Security', () => {
    it('should safely render malicious variable names without executing scripts', () => {
      const testInput = 'test@evil.com{{<img src=x onerror=alert(1)>}}'
      const { container } = render(<SupportVarInput value={testInput} readonly={true} />)

      const scriptElements = container.querySelectorAll('script')
      const imgElements = container.querySelectorAll('img')

      expect(scriptElements).toHaveLength(0)
      expect(imgElements).toHaveLength(0)

      const textContent = container.textContent
      expect(textContent).toContain('<img')
    })
  })

  describe('React Automatic Escaping Verification', () => {
    it('should confirm React automatic escaping works correctly', () => {
      const TestComponent = () => <span>{'<script>alert("xss")</script>'}</span>
      const { container } = render(<TestComponent />)

      const spanElement = container.querySelector('span')
      const scriptElements = container.querySelectorAll('script')

      expect(spanElement?.textContent).toBe('<script>alert("xss")</script>')
      expect(scriptElements).toHaveLength(0)
    })
  })
})

export {}
