import { describe, expect, it } from 'vitest'
import { ENV_REGISTRY } from '@/env/registry'
import { findTopic, TOPICS } from './topics'

function render(name: string): string {
  const topic = findTopic(name)
  if (!topic)
    throw new Error(`topic not found: ${name}`)
  return topic.render()
}

describe('topic registry', () => {
  it('registers account, agent, environment and external', () => {
    expect(TOPICS.map(t => t.name)).toEqual(['account', 'agent', 'environment', 'external'])
  })

  it('findTopic returns undefined for unknown names', () => {
    expect(findTopic('nope')).toBeUndefined()
  })
})

describe('account topic', () => {
  it('mentions auth login device flow', () => {
    expect(render('account')).toContain('difyctl auth login')
  })

  it('mentions get/describe/run app commands', () => {
    const out = render('account')
    expect(out).toContain('difyctl get app')
    expect(out).toContain('difyctl describe app')
    expect(out).toContain('difyctl run app')
  })

  it('mentions --workspace and env list pointers', () => {
    const out = render('account')
    expect(out).toContain('--workspace')
    expect(out).toContain('difyctl env list')
  })
})

describe('agent topic', () => {
  it('covers output, exit codes, auth, errors and HITL', () => {
    const out = render('agent')
    expect(out).toContain('-o json')
    expect(out).toContain('EXIT CODES')
    expect(out).toContain('DIFY_TOKEN')
    expect(out).toContain('difyctl help -o json')
    expect(out).toContain('HUMAN-IN-THE-LOOP')
  })
})

describe('external topic', () => {
  it('mentions external bearer prefix and login flag', () => {
    const out = render('external')
    expect(out).toContain('dfoe_')
    expect(out).toContain('--external')
    expect(out).toContain('DIFY_TOKEN')
  })

  it('explains workspace empty-list expectation', () => {
    expect(render('external')).toContain('get workspace')
  })
})

describe('environment topic', () => {
  it('starts with the ENVIRONMENT VARIABLES header', () => {
    expect(render('environment').startsWith('ENVIRONMENT VARIABLES\n\n')).toBe(true)
  })

  it('lists every var from ENV_REGISTRY with its description', () => {
    const out = render('environment')
    for (const v of ENV_REGISTRY) {
      expect(out).toContain(v.name)
      expect(out).toContain(v.description)
    }
  })

  it('marks sensitive vars with a never-echoed notice', () => {
    const out = render('environment')
    expect(out).toContain('(treat as secret; never echoed)')
    const sensitiveCount = ENV_REGISTRY.filter(v => v.sensitive).length
    const noticeCount = (out.match(/treat as secret/g) ?? []).length
    expect(noticeCount).toBe(sensitiveCount)
  })
})
