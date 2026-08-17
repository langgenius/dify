import type { CommandConstructor } from '@/framework/command'
import { describe, expect, it } from 'vite-plus/test'
import Login from '@/commands/auth/login/index'
import DescribeApp from '@/commands/describe/app/index'
import ExportStudioApp from '@/commands/export/studio-app/index'
import GetApp from '@/commands/get/app/index'
import ImportStudioApp from '@/commands/import/studio-app/index'
import KnowledgeFsCat from '@/commands/knowledge/fs/cat/index'
import KnowledgeFsDiff from '@/commands/knowledge/fs/diff/index'
import KnowledgeFsFind from '@/commands/knowledge/fs/find/index'
import KnowledgeFsGrep from '@/commands/knowledge/fs/grep/index'
import KnowledgeFsList from '@/commands/knowledge/fs/ls/index'
import KnowledgeFsStat from '@/commands/knowledge/fs/stat/index'
import KnowledgeFsTree from '@/commands/knowledge/fs/tree/index'
import ResumeApp from '@/commands/resume/app/index'
import RunApp from '@/commands/run/app/index'

// Commands an agent chains through; each must expose a non-empty agentGuide
// so the wiring (index.ts override + guide.ts) is never silently dropped.
const GUIDED_COMMANDS: ReadonlyArray<readonly [string, CommandConstructor]> = [
  ['run app', RunApp],
  ['resume app', ResumeApp],
  ['describe app', DescribeApp],
  ['get app', GetApp],
  ['export studio-app', ExportStudioApp],
  ['import studio-app', ImportStudioApp],
  ['auth login', Login],
  ['knowledge fs cat', KnowledgeFsCat],
  ['knowledge fs diff', KnowledgeFsDiff],
  ['knowledge fs find', KnowledgeFsFind],
  ['knowledge fs grep', KnowledgeFsGrep],
  ['knowledge fs ls', KnowledgeFsList],
  ['knowledge fs stat', KnowledgeFsStat],
  ['knowledge fs tree', KnowledgeFsTree],
]

describe('agent guides', () => {
  it.each(GUIDED_COMMANDS)('%s exposes a non-empty agentGuide', (_name, Ctor) => {
    expect(new Ctor().agentGuide().length).toBeGreaterThan(0)
  })
})
