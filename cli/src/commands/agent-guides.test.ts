import type { CommandConstructor } from '@/framework/command'
import { describe, expect, it } from 'vitest'
import Login from '@/commands/auth/login/index'
import DescribeApp from '@/commands/describe/app/index'
import GetApp from '@/commands/get/app/index'
import ResumeApp from '@/commands/resume/app/index'
import RunApp from '@/commands/run/app/index'

// Commands an agent chains through; each must expose a non-empty agentGuide
// so the wiring (index.ts override + guide.ts) is never silently dropped.
const GUIDED_COMMANDS: ReadonlyArray<readonly [string, CommandConstructor]> = [
  ['run app', RunApp],
  ['resume app', ResumeApp],
  ['describe app', DescribeApp],
  ['get app', GetApp],
  ['auth login', Login],
]

describe('agent guides', () => {
  it.each(GUIDED_COMMANDS)('%s exposes a non-empty agentGuide', (_name, Ctor) => {
    expect(new Ctor().agentGuide().length).toBeGreaterThan(0)
  })
})
