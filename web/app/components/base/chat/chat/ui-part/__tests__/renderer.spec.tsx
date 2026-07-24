import type { UIPart } from '@/types/a2ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UIPartList } from '../renderer'

function createPart(
  messages: UIPart['messages'],
  fallback = 'Unable to display this widget.',
): UIPart {
  return {
    part_id: 'weather',
    sequence: 1,
    protocol: 'a2ui',
    protocol_version: 'v0.9.1',
    messages,
    fallback,
  }
}

describe('UIPartList', () => {
  it('renders a root-adjacent read-only surface with data bindings', () => {
    render(
      <UIPartList
        parts={[
          createPart([
            {
              version: 'v0.9.1',
              createSurface: {
                surfaceId: 'forecast',
                catalogId: 'https://dify.ai/a2ui/catalog/v1',
              },
            },
            {
              version: 'v0.9.1',
              updateDataModel: {
                surfaceId: 'forecast',
                value: {
                  city: 'Shanghai',
                  temperature: 31,
                },
              },
            },
            {
              version: 'v0.9.1',
              updateComponents: {
                surfaceId: 'forecast',
                components: [
                  { id: 'root', component: 'Card', children: ['city', 'temperature'] },
                  {
                    id: 'city',
                    component: 'Card',
                    children: [],
                    title: { path: '/city' },
                  },
                  {
                    id: 'temperature',
                    component: 'Metric',
                    label: 'Temperature',
                    value: { path: '/temperature' },
                    unit: '°C',
                  },
                ],
              },
            },
          ]),
        ]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Shanghai' })).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument()
    expect(screen.getByText('°C')).toBeInTheDocument()
  })

  it('uses fallback content when the component graph has a cycle', () => {
    render(
      <UIPartList
        parts={[
          createPart(
            [
              {
                version: 'v0.9.1',
                createSurface: {
                  surfaceId: 'cycle',
                  catalogId: 'https://dify.ai/a2ui/catalog/v1',
                },
              },
              {
                version: 'v0.9.1',
                updateComponents: {
                  surfaceId: 'cycle',
                  components: [
                    { id: 'root', component: 'Card', children: ['loop'] },
                    { id: 'loop', component: 'Column', children: ['root'] },
                  ],
                },
              },
            ],
            'Weather summary is unavailable.',
          ),
        ]}
      />,
    )

    expect(screen.getByText('Weather summary is unavailable.')).toBeInTheDocument()
  })

  it('fails closed instead of expanding a shared-child component graph', () => {
    render(
      <UIPartList
        parts={[
          createPart(
            [
              {
                version: 'v0.9.1',
                createSurface: {
                  surfaceId: 'shared-child',
                  catalogId: 'https://dify.ai/a2ui/catalog/v1',
                },
              },
              {
                version: 'v0.9.1',
                updateComponents: {
                  surfaceId: 'shared-child',
                  components: [
                    { id: 'root', component: 'Row', children: ['left', 'right'] },
                    { id: 'left', component: 'Column', children: ['shared'] },
                    { id: 'right', component: 'Column', children: ['shared'] },
                    { id: 'shared', component: 'Text', text: 'Do not expand me' },
                  ],
                },
              },
            ],
            'Widget graph was rejected.',
          ),
        ]}
      />,
    )

    expect(screen.getByText('Widget graph was rejected.')).toBeInTheDocument()
    expect(screen.queryByText('Do not expand me')).not.toBeInTheDocument()
  })

  it('renders Progress with its required accessible label', () => {
    render(
      <UIPartList
        parts={[
          createPart([
            {
              version: 'v0.9.1',
              createSurface: {
                surfaceId: 'progress',
                catalogId: 'https://dify.ai/a2ui/catalog/v1',
              },
            },
            {
              version: 'v0.9.1',
              updateComponents: {
                surfaceId: 'progress',
                components: [
                  {
                    id: 'root',
                    component: 'Progress',
                    value: 75,
                    label: 'Forecast loaded',
                  },
                ],
              },
            },
          ]),
        ]}
      />,
    )

    expect(screen.getByRole('progressbar', { name: 'Forecast loaded' })).toHaveAttribute(
      'aria-valuenow',
      '75',
    )
  })
})
