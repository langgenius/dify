import { cleanUpSvgCode, prepareMermaidCode, sanitizeMermaidCode } from './utils'

describe('cleanUpSvgCode', () => {
  it('replaces old-style <br> tags with the new style', () => {
    const result = cleanUpSvgCode('<br>test<br>')
    expect(result).toEqual('<br/>test<br/>')
  })
})

describe('sanitizeMermaidCode', () => {
  it('removes click directives to prevent link/callback injection', () => {
    const unsafeProtocol = ['java', 'script:'].join('')
    const input = [
      'gantt',
      'title Demo',
      'section S1',
      'Task 1 :a1, 2020-01-01, 1d',
      `click A href "${unsafeProtocol}alert(location.href)"`,
      'click B call callback()',
    ].join('\n')

    const result = sanitizeMermaidCode(input)

    expect(result).toContain('gantt')
    expect(result).toContain('Task 1')
    expect(result).not.toContain('click A')
    expect(result).not.toContain('click B')
    expect(result).not.toContain(unsafeProtocol)
  })

  it('removes Mermaid init directives to prevent config overrides', () => {
    const input = [
      '%%{init: {"securityLevel":"loose"}}%%',
      'graph TD',
      'A-->B',
    ].join('\n')

    const result = sanitizeMermaidCode(input)

    expect(result).toEqual(['graph TD', 'A-->B'].join('\n'))
  })
})

describe('prepareMermaidCode', () => {
  it('sanitizes click directives in flowcharts', () => {
    const unsafeProtocol = ['java', 'script:'].join('')
    const input = [
      'graph TD',
      'A[Click]-->B',
      `click A href "${unsafeProtocol}alert(1)"`,
    ].join('\n')

    const result = prepareMermaidCode(input, 'classic')

    expect(result).toContain('graph TD')
    expect(result).not.toContain('click ')
    expect(result).not.toContain(unsafeProtocol)
  })
})
