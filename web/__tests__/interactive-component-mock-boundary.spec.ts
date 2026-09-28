import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const testFilePattern = /\.(?:spec|test)\.[cm]?[jt]sx?$/
const interactivePrimitiveMockPattern =
  /vi\.mock\(\s*['"]@langgenius\/dify-ui\/(?:alert-dialog|avatar|button|dialog|dropdown-menu|pagination|popover|select|slider|switch|textarea|tooltip)['"]/
const interactiveWrapperMockPattern =
  /vi\.mock\(\s*['"][^'"]*(?:block-selector|plugin-version-picker|time-picker)['"]/

const collectTestFiles = (directory: string): string[] => {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectTestFiles(path)
    return testFilePattern.test(entry.name) ? [path] : []
  })
}

describe('interactive component mock boundary', () => {
  it('keeps Dify UI primitives and feature-owned interactive wrappers real', () => {
    const webRoot = process.cwd()
    const testFiles = ['__tests__', 'app', 'features'].flatMap((directory) =>
      collectTestFiles(resolve(webRoot, directory)),
    )
    const violations = testFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      if (
        !interactivePrimitiveMockPattern.test(source) &&
        !interactiveWrapperMockPattern.test(source)
      ) {
        return []
      }
      return [relative(webRoot, file)]
    })

    expect(violations).toEqual([])
  })
})
