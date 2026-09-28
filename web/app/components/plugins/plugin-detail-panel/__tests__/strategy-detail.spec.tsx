import type {
  AgentStrategyEntity,
  AgentStrategyProviderIdentity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import StrategyDetail from '../strategy-detail'

const provider: AgentStrategyProviderIdentity = {
  author: 'test-author',
  name: 'test-provider',
  description: { en_US: 'Provider description' },
  icon: 'icon.png',
  label: { en_US: 'Test Provider' },
}

const createStrategy = (): AgentStrategyEntity => ({
  identity: {
    author: 'author-1',
    name: 'strategy-1',
    label: { en_US: 'Strategy Label' },
    provider: 'provider-1',
  },
  description: { en_US: 'Strategy description' },
  parameters: [
    {
      name: 'query',
      label: { en_US: 'Search query' },
      type: 'string',
      required: true,
      help: { en_US: 'A text parameter' },
    },
    { name: 'count', label: { en_US: 'Result count' }, type: 'number' },
    { name: 'enabled', label: { en_US: 'Enabled' }, type: 'boolean', help: null },
    { name: 'file', label: { en_US: 'Input file' }, type: 'file' },
    { name: 'tools', label: { en_US: 'Tools' }, type: 'array[tools]' },
  ],
  output_schema: {
    properties: {
      result: { type: 'string', description: 'Result output' },
      items: { type: 'array', items: { type: 'string' }, description: 'Array items' },
    },
  },
})

const renderDetails = (detail: AgentStrategyEntity) =>
  render(
    <StrategyDetail provider={provider} tenantId="tenant-1" detail={detail} onHide={vi.fn()} />,
  )

describe('Strategy details contract', () => {
  it('displays API parameter types and help alongside output schema descriptions', () => {
    renderDetails(createStrategy())
    const drawer = within(screen.getByRole('dialog', { name: 'Strategy Label' }))

    expect(drawer.getByText('Search query')).toBeInTheDocument()
    expect(drawer.getByText('tools.setBuiltInTools.string')).toBeInTheDocument()
    expect(drawer.getByText('tools.setBuiltInTools.required')).toBeInTheDocument()
    expect(drawer.getByText('A text parameter')).toBeInTheDocument()
    expect(drawer.getByText('tools.setBuiltInTools.number')).toBeInTheDocument()
    expect(drawer.getByText('boolean')).toBeInTheDocument()
    expect(drawer.getByText('tools.setBuiltInTools.file')).toBeInTheDocument()
    expect(drawer.getByText('multiple-tool-select')).toBeInTheDocument()
    expect(drawer.getByText('String')).toBeInTheDocument()
    expect(drawer.getByText('Array[String]')).toBeInTheDocument()
    expect(drawer.getByText('Result output')).toBeInTheDocument()
    expect(drawer.getByText('Array items')).toBeInTheDocument()
  })

  it('accepts optional parameters and a null output schema', () => {
    renderDetails({ ...createStrategy(), parameters: undefined, output_schema: null })

    expect(screen.getByRole('dialog', { name: 'Strategy Label' })).toBeInTheDocument()
    expect(screen.queryByText('Search query')).not.toBeInTheDocument()
    expect(screen.queryByText('OUTPUT')).not.toBeInTheDocument()
  })

  it('safely displays JSON schema properties that do not declare a simple type', () => {
    renderDetails({
      ...createStrategy(),
      output_schema: {
        properties: {
          unconstrained: true,
          reference: { $ref: '#/$defs/result' },
          union: { type: ['string', 'null'] },
          tuple: { type: 'array', prefixItems: [{ type: 'number' }] },
        },
      },
    })

    expect(screen.getByText('unconstrained')).toBeInTheDocument()
    expect(screen.getByText('reference')).toBeInTheDocument()
    expect(screen.getByText('union')).toBeInTheDocument()
    expect(screen.getAllByText('Unknown')).toHaveLength(3)
    expect(screen.getByText('Array[Unknown]')).toBeInTheDocument()
  })
})
