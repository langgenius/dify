import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HumanInputMigrationBanner from '../migration-banner'

describe('Human Input migration banner', () => {
  it('shows guidance, opens documentation, and starts migration for editors', async () => {
    const user = userEvent.setup()
    const onMigrate = vi.fn()
    render(
      <HumanInputMigrationBanner
        canEdit
        helpLink="https://docs.example/human-input"
        onMigrate={onMigrate}
      />,
    )

    expect(
      screen.getByRole('complementary', {
        name: 'workflow.nodes.humanInputMigration.banner.ariaLabel',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInputMigration.banner.title')).toBeInTheDocument()
    expect(
      screen.getByText('workflow.nodes.humanInputMigration.banner.description'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'workflow.nodes.humanInputMigration.banner.learnMore',
      }),
    ).toHaveAttribute('href', 'https://docs.example/human-input')

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
    )
    expect(onMigrate).toHaveBeenCalledTimes(1)
  })

  it('keeps the explanation and documentation but hides migration for read-only users', () => {
    render(
      <HumanInputMigrationBanner
        canEdit={false}
        helpLink="https://docs.example/human-input"
        onMigrate={vi.fn()}
      />,
    )

    expect(
      screen.getByText('workflow.nodes.humanInputMigration.banner.description'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
    ).not.toBeInTheDocument()
  })
})
