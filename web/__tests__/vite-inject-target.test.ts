import fs from 'node:fs'
import path from 'node:path'
import { getRootClientInjectTarget, rootClientInjectTargetRelativePath } from '@/plugins/vite/inject-target'

const projectRoot = process.cwd()
const rootLayoutFile = path.resolve(projectRoot, 'app/layout.tsx')
const rootClientInjectTarget = getRootClientInjectTarget(projectRoot)

describe('vite dev inject target', () => {
  describe('target module', () => {
    it('should point to an existing root-mounted client component', () => {
      expect(rootClientInjectTarget).toBe(path.resolve(projectRoot, rootClientInjectTargetRelativePath))
      expect(fs.existsSync(rootClientInjectTarget)).toBe(true)

      const targetCode = fs.readFileSync(rootClientInjectTarget, 'utf-8')

      expect(targetCode).toMatch(/^'use client'/)
    })
  })

  describe('root layout wiring', () => {
    it('should import and render the inject target from the root layout', () => {
      const layoutCode = fs.readFileSync(rootLayoutFile, 'utf-8')

      expect(layoutCode).toContain('import RoutePrefixHandle from \'./routePrefixHandle\'')
      expect(layoutCode).toContain('<RoutePrefixHandle />')
    })
  })
})
