const interactivePrimitiveMockPattern =
  /vi\.mock\(\s*['"]@langgenius\/dify-ui\/(?:alert-dialog|avatar|button|dialog|menu|pagination|popover|select|slider|switch|textarea|tooltip)['"]/
const interactiveWrapperMockPattern =
  /vi\.mock\(\s*['"][^'"]*(?:block-selector|plugin-version-picker|time-picker|prompt-editor)(?:\/index)?['"]/

// A glob import keeps every test file in the module graph, so `--changed` reruns this spec for them.
const testSources = import.meta.glob<string>(
  '/{__tests__,app,features}/**/*.{spec,test}.{js,jsx,ts,tsx,cjs,cts,mjs,mts}',
  { eager: true, query: '?raw', import: 'default' },
)

describe('interactive component mock boundary', () => {
  it('keeps Dify UI primitives and feature-owned interactive wrappers real', () => {
    const violations = Object.entries(testSources).flatMap(([file, source]) => {
      if (
        !interactivePrimitiveMockPattern.test(source) &&
        !interactiveWrapperMockPattern.test(source)
      ) {
        return []
      }
      return [file.slice(1)]
    })

    expect(violations).toEqual([])
  })
})
