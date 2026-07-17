import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToolTypeEnum } from '../../../workflow/block-selector/types'
import Empty from '../empty'

vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))

describe('Empty', () => {
  it.each([
    [ToolTypeEnum.Custom, '/integrations/tools/api'],
    [ToolTypeEnum.MCP, '/integrations/tools/mcp'],
  ])('links the %s empty state to its integration page', (type, href) => {
    render(<Empty type={type} />)

    expect(screen.getByRole('link')).toHaveAttribute('href', href)
  })

  it('links the workflow guide to Studio and the documentation', () => {
    render(<Empty type={ToolTypeEnum.Workflow} />)

    expect(screen.getByRole('link', { name: /goToStudio/i })).toHaveAttribute('href', '/apps')
    expect(screen.getByRole('link', { name: /learnMore/i })).toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/self-host/use-dify/workspace/tools#workflow',
    )
  })

  it('does not offer installation navigation in an agent empty state', () => {
    render(<Empty type={ToolTypeEnum.Custom} isAgent />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
