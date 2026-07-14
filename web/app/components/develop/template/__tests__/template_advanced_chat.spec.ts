import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const templates = [
  ['English', 'template_advanced_chat.en.mdx'],
  ['Japanese', 'template_advanced_chat.ja.mdx'],
  ['Chinese', 'template_advanced_chat.zh.mdx'],
] as const

describe.each(templates)('%s advanced chat API template', (_language, templateFile) => {
  it('should show the workflow version upgrade action next to workflow_id', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/components/develop/template', templateFile),
      'utf8',
    )

    expect(source).toContain(
      "import { WorkflowVersionApiUpgradeNotice } from '../workflow-version-api-upgrade-notice.tsx'",
    )
    expect(source).toContain(
      "<Property name='workflow_id' type='string' key='workflow_id' nameAction={<WorkflowVersionApiUpgradeNotice />}>",
    )
    expect(source).not.toContain('titleAction={<WorkflowVersionApiUpgradeNotice />}')
  })

  it('should document the workflow version plan error', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/components/develop/template', templateFile),
      'utf8',
    )

    expect(source).toContain('403')
    expect(source).toContain('workflow_version_execution_not_allowed')
  })
})
