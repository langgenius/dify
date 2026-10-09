import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '.'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu'
import { IconButton } from '../icon-button'

const meta = {
  title: 'Base/UI/Breadcrumb',
  component: Breadcrumb,
  parameters: {
    layout: 'centered',
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
    docs: {
      description: {
        component:
          'Explicit navigation anatomy with a required localized aria-label or aria-labelledby. ' +
          'Separators are decorative list siblings. Only BreadcrumbLink supports render, for components that forward props and refs to an anchor. ' +
          'Current links remain interactive; BreadcrumbPage is static text. No route inference, automatic separators, truncation, or collapsing. ' +
          'The default layout is a single row with consistent typography and tertiary ancestor links / primary current text. ' +
          'Consumers own typography overrides, available width, and overflow handling.',
      },
    },
  },
  args: { 'aria-label': 'Breadcrumb' },
  decorators: [
    (Story) => (
      <div className="bg-background-default p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Breadcrumb>

export default meta
type Story = StoryObj<typeof Breadcrumb>

export const Default: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#home">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#knowledge">Knowledge</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Product documents</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvas, userEvent }) => {
    const navigation = within(canvas.getByRole('navigation', { name: 'Breadcrumb' }))
    await expect(navigation.getAllByRole('listitem')).toHaveLength(3)
    const home = navigation.getByRole('link', { name: 'Home' })
    home.focus()
    await userEvent.tab()
    await expect(navigation.getByRole('link', { name: 'Knowledge' })).toHaveFocus()
    await expect(navigation.getByText('Product documents')).toHaveAttribute('aria-current', 'page')
  },
}

export const CurrentPageLink: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#home">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#documents" aria-current="page">
            Documents
          </BreadcrumbLink>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('link', { name: 'Home' }).focus()
    await userEvent.tab()
    const current = canvas.getByRole('link', { name: 'Documents', current: 'page' })
    await expect(current).toHaveFocus()
    await expect(current).toHaveAttribute('href', '#documents')
    await expect(current).not.toHaveAttribute('aria-disabled')
  },
}

function StoryLink({ children, ...props }: React.ComponentProps<'a'>) {
  return <a {...props}>{children}</a>
}

function RenderLinkExample() {
  const ref = React.useRef<HTMLAnchorElement>(null)
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb aria-label="Project path">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink ref={ref} render={<StoryLink href="#projects" />}>
              Projects
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Design system</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <button
        type="button"
        className="self-start text-text-secondary underline focus-visible:outline-2"
        onClick={() => ref.current?.focus()}
      >
        Focus project link
      </button>
    </div>
  )
}

export const RenderLink: Story = {
  render: () => <RenderLinkExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Focus project link' }))
    await expect(canvas.getByRole('link', { name: 'Projects' })).toHaveFocus()
    await expect(canvas.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '#projects',
    )
  },
}

export const LabelledBy: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <h2 id="breadcrumb-story-heading" className="system-md-medium text-text-primary">
        Project location
      </h2>
      <Breadcrumb aria-labelledby="breadcrumb-story-heading">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#projects">Projects</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Design system</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  ),
}

export const RightToLeft: Story = {
  render: () => (
    <Breadcrumb dir="rtl" aria-label="مسار التنقل" lang="ar">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#home">الرئيسية</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <span className="i-ri-arrow-left-s-line size-4" />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbLink href="#knowledge">المعرفة</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <span className="i-ri-arrow-left-s-line size-4" />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>المستندات</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}

export const TruncatedLabel: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The consumer constrains one item and truncates its text, leaving the anchor focus outline and its full accessible name intact.',
      },
    },
  },
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#home">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="max-w-40">
          <BreadcrumbLink href="#research">
            <span className="truncate">Research and development documentation</span>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Overview</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}

export const CollapsedAncestors: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Collapsing is an explicit DropdownMenu composition. Its trigger owns the accessible name; hidden ancestors remain links. Escape restores focus to the trigger.',
      },
    },
  },
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#home">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton aria-label="Show ancestor pages">
                  <span aria-hidden className="i-ri-more-line size-4" />
                </IconButton>
              }
            />
            <DropdownMenuContent>
              <DropdownMenuItem render={<a href="#projects" />}>Projects</DropdownMenuItem>
              <DropdownMenuItem render={<a href="#knowledge" />}>Knowledge</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Documents</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Show ancestor pages' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitem', { name: 'Projects' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const Dark: Story = {
  ...Default,
  globals: { theme: 'dark' },
}

export const Typography: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Set typography on the list to change the size and weight of every item together. Links and current text inherit these styles.',
      },
    },
  },
  render: () => (
    <Breadcrumb aria-label="Documentation path">
      <BreadcrumbList className="text-lg/6 font-semibold">
        <BreadcrumbItem>
          <BreadcrumbLink href="#documentation">Documentation</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Getting started</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}
