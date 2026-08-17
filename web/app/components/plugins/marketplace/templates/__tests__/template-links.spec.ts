import { describe, expect, it } from 'vite-plus/test'
import { buildTemplatesHref } from '../template-links'

describe('buildTemplatesHref', () => {
  it('appends selected languages as a comma-separated query value', () => {
    expect(buildTemplatesHref({ category: 'all', languages: ['en', 'ja'] })).toBe(
      '/templates?languages=en%2Cja',
    )
  })
})
