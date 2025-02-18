import cn from './classnames'

describe('classnames', () => {
  test('classnames libs feature', () => {
    expect(cn('foo')).toBe('foo')
    expect(cn('foo', 'bar')).toBe('foo bar')
    expect(cn(['foo', 'bar'])).toBe('foo bar')

    expect(cn(undefined)).toBe('')
    expect(cn(null)).toBe('')
    expect(cn(false)).toBe('')

    expect(cn({
      foo: true,
      bar: false,
      baz: true,
    })).toBe('foo baz')
  })

  test('tailwind-merge', () => {
    expect(cn('p-0')).toBe('p-0')
    expect(cn('text-left text-center text-right')).toBe('text-left')
    expect(cn('p-8 pl-4')).toBe('p-8')
    expect(cn('m-[2px] m-[4px]')).toBe('m-[4px]')
    expect(cn('m-1 m-[4px]')).toBe('m-[4px]')
    expect(cn('overflow-x-auto overflow-x-scroll hover:overflow-x-hidden')).toBe(
      'hover:overflow-x-hidden overflow-x-scroll',
    )
    expect(cn('h-10 h-min')).toBe('h-min')
    expect(cn('bg-grey-5 bg-hotpink')).toBe('bg-hotpink')

    expect(cn('hover:block hover:inline')).toBe('hover:inline')

    expect(cn('!font-bold font-medium')).toBe('font-medium !font-bold')
    expect(cn('!font-bold !font-medium')).toBe('!font-bold')

    expect(cn('text-primary-200 text-gray-100')).toBe('text-primary-200')
    expect(cn('text-some-unknown-color text-components-input-bg-disabled text-primary-200')).toBe('text-primary-200')
    expect(cn('bg-some-unknown-color bg-components-input-bg-disabled bg-primary-200')).toBe('bg-primary-200')

    expect(cn('border-t border-white/10')).toBe('border-t border-white/10')
    expect(cn('border-t border-white')).toBe('border-t border-white')
    expect(cn('text-3.5xl text-black')).toBe('text-3.5xl text-black')
  })

  test('classnames combined with tailwind-merge', () => {
    expect(cn('text-right', {
      'text-center': true,
    })).toBe('text-center')

    expect(cn('text-right', {
      'text-center': false,
    })).toBe('text-right')
  })
})
