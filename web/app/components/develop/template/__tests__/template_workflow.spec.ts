import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const templates = [
  ['English', 'template_workflow.en.mdx'],
  ['Japanese', 'template_workflow.ja.mdx'],
  ['Chinese', 'template_workflow.zh.mdx'],
] as const

describe.each(templates)('%s workflow API template', (_language, templateFile) => {
  it('should hide only the paid API details behind the plan gate', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/components/develop/template', templateFile),
      'utf8',
    )
    const paidApiStart = source.indexOf("name='#Execute-Specific-Workflow'")
    const nextApiStart = source.indexOf("url='/workflows/run/:workflow_run_id'", paidApiStart)
    const paidApi = source.slice(paidApiStart, nextApiStart)

    expect(paidApiStart).toBeGreaterThanOrEqual(0)
    expect(nextApiStart).toBeGreaterThan(paidApiStart)
    expect(paidApi).toContain('titleAction={<WorkflowVersionApiUpgradeNotice />}')
    expect(paidApi).toContain('<WorkflowVersionApiContent>\n<Row>')
    expect(paidApi).toContain('</Row>\n</WorkflowVersionApiContent>')
  })
})
