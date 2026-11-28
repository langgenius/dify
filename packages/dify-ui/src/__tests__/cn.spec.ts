import { cn } from '../cn'
import utilitiesCss from '../styles/utilities.css?raw'

const utilities = [...utilitiesCss.matchAll(/@utility\s+([\w-]+)\s*\{([^}]*)\}/g)].map(
  ([, name, body]) => ({ name: name!, uppercase: /text-transform:\s*uppercase/.test(body!) }),
)

describe('cn typography utilities', () => {
  it('reads the typography utilities from utilities.css', () => {
    expect(utilities.length).toBeGreaterThan(0)
  })

  it.each(utilities)(
    '$name replaces earlier font-size, font-weight, and line-height',
    ({ name }) => {
      expect(cn('text-[13px] leading-6 font-medium', name)).toBe(name)
    },
  )

  it.each(utilities)('$name replaces an earlier typography utility', ({ name }) => {
    const earlier = name === 'system-kbd' ? 'system-xs-medium' : 'system-kbd'
    expect(cn(earlier, name)).toBe(name)
  })

  it.each(utilities)(
    '$name replaces an earlier text-transform only when it sets one',
    ({ name, uppercase }) => {
      expect(cn('capitalize', name)).toBe(uppercase ? name : `capitalize ${name}`)
    },
  )

  it('replaces an earlier uppercase utility with a plain one and the other way around', () => {
    expect(cn('system-xs-medium-uppercase', 'system-sm-regular')).toBe('system-sm-regular')
    expect(cn('system-sm-regular', 'system-xs-medium-uppercase')).toBe('system-xs-medium-uppercase')
  })

  it('keeps a later font-size, font-weight, or line-height on top of a typography utility', () => {
    expect(cn('system-md-semibold', 'text-[13px]/4')).toBe('system-md-semibold text-[13px]/4')
    expect(cn('system-sm-regular', 'font-medium')).toBe('system-sm-regular font-medium')
    expect(cn('system-sm-medium', 'leading-6')).toBe('system-sm-medium leading-6')
    expect(cn('system-xs-medium-uppercase', 'normal-case')).toBe(
      'system-xs-medium-uppercase normal-case',
    )
  })

  it('leaves unrelated text utilities alone', () => {
    expect(cn('system-sm-medium text-text-secondary', 'system-md-semibold')).toBe(
      'text-text-secondary system-md-semibold',
    )
  })
})
