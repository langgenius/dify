import type { Datasource } from '../../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import DataSourceOptions from '../index'

// Provider icons are independent of datasource discovery and selection.
vi.mock('@/app/components/workflow/hooks/use-tool-icon', () => ({ useToolIcon: () => undefined }))

const sources = ['Website', 'Drive'].map((title) =>
  createNode({
    id: title.toLowerCase(),
    data: {
      type: BlockEnum.DataSource,
      title,
      plugin_id: 'plugin-1',
      provider_type: 'online_document',
      provider_name: 'source',
      datasource_name: 'source',
      datasource_label: title,
      datasource_parameters: {},
      datasource_configurations: {},
    },
  }),
)

function Selection({ initialId }: { initialId: string }) {
  const nodes = useNodes()
  const [selected, setSelected] = useState<Datasource>()
  // The production preparation panel mounts after its graph is initialized.
  if (!nodes.length) return null
  return (
    <>
      <DataSourceOptions dataSourceNodeId={selected?.nodeId ?? initialId} onSelect={setSelected} />
      <output aria-label="Selected datasource">{JSON.stringify(selected)}</output>
    </>
  )
}
const renderOptions = (initialId = '') =>
  renderWorkflowFlowComponent(<Selection initialId={initialId} />, {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    nodes: sources,
  })
const selected = (): Datasource =>
  JSON.parse(screen.getByRole('status', { name: 'Selected datasource' }).textContent!)

describe('DataSourceOptions', () => {
  it('selects the first canvas datasource when no selection exists', () => {
    renderOptions()
    expect(screen.getByRole('radio', { name: 'Website' })).toBeChecked()
    expect(selected()).toMatchObject({ nodeId: 'website', nodeData: sources[0]!.data })
  })

  it('selects the datasource chosen by the user', async () => {
    const user = userEvent.setup()
    renderOptions('website')
    const website = screen.getByRole('radio', { name: 'Website' })
    website.focus()
    expect(website).toBeChecked()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Drive' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Drive' })).toBeChecked()
    expect(website).not.toBeChecked()
    expect(selected()).toMatchObject({ nodeId: 'drive', nodeData: sources[1]!.data })
  })
})
