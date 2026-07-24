import type { A2UIComponent, UIPart } from '@/types/a2ui'
import { describe, expect, it } from 'vitest'
import {
  buildUISurfaces,
  normalizeUIParts,
  parseUIPart,
  parseUIPartEnvelope,
  reconcileHistoryUIParts,
  resolveJSONPointer,
  upsertUIPart,
} from '../state'

function createPart(overrides: Partial<UIPart> = {}): UIPart {
  return {
    part_id: 'weather',
    sequence: 1,
    protocol: 'a2ui',
    protocol_version: 'v0.9.1',
    messages: [
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
            { id: 'city', component: 'Text', text: { path: '/city' } },
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
    ],
    fallback: 'Weather is unavailable.',
    ...overrides,
  }
}

function createLargePart(partId: string): UIPart {
  const largeModel = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`value-${index}`, 'x'.repeat(4_096)]),
  )
  return createPart({
    part_id: partId,
    messages: [
      {
        version: 'v0.9.1',
        createSurface: {
          surfaceId: 'large',
          catalogId: 'https://dify.ai/a2ui/catalog/v1',
        },
      },
      {
        version: 'v0.9.1',
        updateDataModel: {
          surfaceId: 'large',
          value: largeModel,
        },
      },
      {
        version: 'v0.9.1',
        updateComponents: {
          surfaceId: 'large',
          components: [{ id: 'root', component: 'Text', text: 'Large widget' }],
        },
      },
    ],
  })
}

describe('ui part state', () => {
  it('keeps insertion order while replacing a part only with a newer sequence', () => {
    const weather = createPart()
    const clock = createPart({ part_id: 'clock', sequence: 2 })
    const initial = upsertUIPart(upsertUIPart([], weather), clock)

    expect(upsertUIPart(initial, createPart({ sequence: 0 }))).toEqual(initial)

    const updated = upsertUIPart(initial, createPart({ sequence: 3, fallback: 'updated' }))
    expect(updated.map((part) => part.part_id)).toEqual(['weather', 'clock'])
    expect(updated[0]?.sequence).toBe(3)
    expect(updated[0]?.fallback).toBe('updated')
  })

  it('keeps existing live parts when a seventeenth distinct part exceeds the collection limit', () => {
    const liveParts = Array.from({ length: 16 }, (_, index) =>
      createPart({ part_id: `part-${index}` }),
    )
    const overflowPart = createPart({ part_id: 'part-16' })

    expect(upsertUIPart(liveParts, overflowPart)).toBe(liveParts)
    expect(normalizeUIParts([...liveParts, overflowPart])).toEqual([])
    expect(reconcileHistoryUIParts(liveParts, [...liveParts, overflowPart])).toBe(liveParts)
  })

  it('keeps existing live parts when history exceeds the 512 KiB collection budget', () => {
    const liveParts = [createPart()]
    const oversizedHistory = Array.from({ length: 7 }, (_, index) =>
      createLargePart(`large-${index}`),
    )
    const withinBudget = oversizedHistory.slice(0, 6)

    expect(upsertUIPart(withinBudget, oversizedHistory[6])).toBe(withinBudget)
    expect(normalizeUIParts(oversizedHistory)).toEqual([])
    expect(reconcileHistoryUIParts(liveParts, oversizedHistory)).toBe(liveParts)
  })

  it('limits history normalization to sixty-four candidates even for repeated part ids', () => {
    const liveParts = [createPart({ sequence: 100 })]
    const boundedHistory = Array.from({ length: 64 }, (_, index) =>
      createPart({ sequence: index + 1 }),
    )
    const oversizedHistory = [
      ...boundedHistory,
      createPart({ sequence: boundedHistory.length + 1 }),
    ]

    expect(normalizeUIParts(boundedHistory)).toEqual([createPart({ sequence: 64 })])
    expect(normalizeUIParts(oversizedHistory)).toEqual([])
    expect(reconcileHistoryUIParts(liveParts, oversizedHistory)).toBe(liveParts)
  })

  it('retains live UI when an older history response omits ui_parts', () => {
    const liveParts = [createPart()]

    expect(reconcileHistoryUIParts(liveParts, undefined)).toBe(liveParts)
    expect(reconcileHistoryUIParts(liveParts, [])).toEqual([])
  })

  it('rejects envelopes outside the fixed catalog and component schema', () => {
    const unknownComponent = createPart({
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [
              {
                id: 'root',
                component: 'Button',
                action: 'buy',
              } as never,
            ],
          },
        },
      ],
    })
    const styledComponent = createPart({
      part_id: 'styled',
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'unsafe',
                className: 'fixed inset-0',
              } as never,
            ],
          },
        },
      ],
    })
    const imageComponent = createPart({
      part_id: 'image',
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [
              {
                id: 'root',
                component: 'Image',
                src: 'https://example.com/weather.png',
              } as never,
            ],
          },
        },
      ],
    })

    expect(normalizeUIParts([unknownComponent, styledComponent, imageComponent])).toEqual([])
  })

  it('requires an accessible label for Progress components', () => {
    const unlabeledProgress = createPart({
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [
              {
                id: 'root',
                component: 'Progress',
                value: 50,
              } as never,
            ],
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(unlabeledProgress)).toBeUndefined()
  })

  it('rejects duplicate component ids within a single update', () => {
    const duplicateComponents = createPart({
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [
              { id: 'root', component: 'Text', text: 'First' },
              { id: 'root', component: 'Text', text: 'Second' },
            ],
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(duplicateComponents)).toBeUndefined()
  })

  it('applies the single-part byte limit to the API payload without stream wrapper fields', () => {
    const repeatedModelUpdate: UIPart['messages'][number] = {
      version: 'v0.9.1',
      updateDataModel: {
        surfaceId: 'forecast',
        value: { payload: 'x'.repeat(4_096) },
      },
    }
    const messages: UIPart['messages'] = [
      {
        version: 'v0.9.1',
        createSurface: {
          surfaceId: 'forecast',
          catalogId: 'https://dify.ai/a2ui/catalog/v1',
        },
      },
      ...Array.from({ length: 31 }, () => repeatedModelUpdate),
      {
        version: 'v0.9.1',
        updateComponents: {
          surfaceId: 'forecast',
          components: [{ id: 'root', component: 'Text', text: 'Widget' }],
        },
      },
    ]
    const payloadWithoutFallback = {
      protocol: 'a2ui' as const,
      protocol_version: 'v0.9.1' as const,
      messages,
    }
    const payloadWithEmptyFallbackBytes = new TextEncoder().encode(
      JSON.stringify({ ...payloadWithoutFallback, fallback: '' }),
    ).byteLength
    const targetPayloadBytes = 128 * 1_024 - 100
    const fallback = 'x'.repeat(targetPayloadBytes - payloadWithEmptyFallbackBytes)
    const part: UIPart = {
      part_id: 'p'.repeat(512),
      sequence: Number.MAX_SAFE_INTEGER,
      ...payloadWithoutFallback,
      fallback,
    }

    expect(
      new TextEncoder().encode(
        JSON.stringify({
          protocol: part.protocol,
          protocol_version: part.protocol_version,
          messages: part.messages,
          fallback: part.fallback,
        }),
      ).byteLength,
    ).toBe(targetPayloadBytes)
    expect(new TextEncoder().encode(JSON.stringify(part)).byteLength).toBeGreaterThan(128 * 1_024)
    expect(parseUIPart(part)).toEqual(part)
  })

  it.each<{
    name: string
    messages: UIPart['messages']
  }>([
    {
      name: 'an update before createSurface',
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'forecast',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
      ],
    },
    {
      name: 'a repeated createSurface',
      messages: [
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'forecast',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'forecast',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
      ],
    },
    {
      name: 'messages targeting multiple surfaces',
      messages: [
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'forecast',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'other',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
      ],
    },
    {
      name: 'deleteSurface before the final message',
      messages: [
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'forecast',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
        {
          version: 'v0.9.1',
          deleteSurface: {
            surfaceId: 'forecast',
          },
        },
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
      ],
    },
    {
      name: 'more than one deleteSurface',
      messages: [
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'forecast',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
        {
          version: 'v0.9.1',
          deleteSurface: {
            surfaceId: 'forecast',
          },
        },
        {
          version: 'v0.9.1',
          deleteSurface: {
            surfaceId: 'forecast',
          },
        },
      ],
    },
  ])('rejects $name', ({ messages }) => {
    expect(parseUIPart(createPart({ messages }))).toBeUndefined()
  })

  it('accepts tool-scoped part ids and enforces the 100-component catalog bound', () => {
    const components = Array.from({ length: 100 }, (_, index) => ({
      id: index === 0 ? 'root' : `component-${index}`,
      component: 'Divider' as const,
    }))
    const boundedPart = createPart({
      part_id: 'call/abc=:weather',
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components,
          },
        },
      ],
    })
    const oversizedPart = createPart({
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [
              ...components,
              {
                id: 'component-100',
                component: 'Divider',
              },
            ],
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(boundedPart)).toEqual(boundedPart)
    expect(parseUIPartEnvelope(oversizedPart)).toBeUndefined()
  })

  it('enforces the same 100-item bound on component children', () => {
    const children = Array.from({ length: 100 }, (_, index) => `child-${index}`)
    const boundedPart = createPart({
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Column', children }],
          },
        },
      ],
    })
    const oversizedPart = createPart({
      messages: [
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [
              {
                id: 'root',
                component: 'Column',
                children: [...children, 'child-100'],
              },
            ],
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(boundedPart)).toEqual(boundedPart)
    expect(parseUIPartEnvelope(oversizedPart)).toBeUndefined()
  })

  it('reduces surface messages and removes deleted surfaces', () => {
    const part = createPart({
      messages: [
        ...createPart().messages,
        {
          version: 'v0.9.1',
          deleteSurface: {
            surfaceId: 'forecast',
          },
        },
      ],
    })

    const result = buildUISurfaces(part.messages)
    expect(result.error).toBeUndefined()
    expect(result.surfaces).toEqual([])
  })

  it.each<{
    name: string
    components: A2UIComponent[]
    error: string
  }>([
    {
      name: 'a duplicate child in one parent',
      components: [
        { id: 'root', component: 'Column', children: ['value', 'value'] },
        { id: 'value', component: 'Text', text: '31°C' },
      ],
      error: 'duplicate_child',
    },
    {
      name: 'a child shared by multiple parents',
      components: [
        { id: 'root', component: 'Row', children: ['left', 'right'] },
        { id: 'left', component: 'Column', children: ['shared'] },
        { id: 'right', component: 'Column', children: ['shared'] },
        { id: 'shared', component: 'Text', text: '31°C' },
      ],
      error: 'multiple_parents',
    },
    {
      name: 'root referenced as a child',
      components: [
        { id: 'root', component: 'Column', children: ['branch'] },
        { id: 'branch', component: 'Column', children: ['root'] },
      ],
      error: 'root_as_child',
    },
    {
      name: 'an unreachable component',
      components: [
        { id: 'root', component: 'Column', children: [] },
        { id: 'orphan', component: 'Text', text: 'hidden' },
      ],
      error: 'unreachable_component',
    },
  ])('rejects $name while reducing a surface', ({ components, error }) => {
    const part = createPart({
      messages: [
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'unsafe',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'unsafe',
            components,
          },
        },
      ],
    })

    expect(buildUISurfaces(part.messages)).toEqual({
      surfaces: [],
      error,
    })
    expect(normalizeUIParts([part])).toEqual([])
  })

  it('immutably upserts nested data model values through JSON Pointer paths', () => {
    const originalModel = {
      current: {
        temperature: 30,
      },
    }
    const part = createPart({
      messages: [
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
            value: originalModel,
          },
        },
        {
          version: 'v0.9.1',
          updateDataModel: {
            surfaceId: 'forecast',
            path: '/current/temperature',
            value: 31,
          },
        },
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
      ],
    })

    const result = buildUISurfaces(part.messages)
    expect(result.surfaces[0]?.dataModel).toEqual({
      current: {
        temperature: 31,
      },
    })
    expect(originalModel.current.temperature).toBe(30)
  })

  it('rejects JSON Pointer paths deeper than sixteen segments', () => {
    const path = `/${Array.from({ length: 17 }, (_, index) => `level-${index}`).join('/')}`
    const part = createPart({
      messages: [
        {
          version: 'v0.9.1',
          updateDataModel: {
            surfaceId: 'forecast',
            path,
            value: 'too deep',
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(part)).toBeUndefined()
  })

  it('rejects consecutive patches that make the final model exceed the depth limit', () => {
    const firstPath = `/${Array.from({ length: 15 }, (_, index) => `level-${index}`).join('/')}`
    const part = createPart({
      messages: [
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
            path: firstPath,
            value: {},
          },
        },
        {
          version: 'v0.9.1',
          updateDataModel: {
            surfaceId: 'forecast',
            path: `${firstPath}/level-15`,
            value: { overflow: true },
          },
        },
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(part)).toEqual(part)
    expect(buildUISurfaces(part.messages)).toEqual({
      surfaces: [],
      error: 'invalid_data_model_update',
    })
  })

  it('rejects consecutive patches that make the final model exceed the node limit', () => {
    const updates: UIPart['messages'] = Array.from({ length: 50 }, (_, index) => ({
      version: 'v0.9.1',
      updateDataModel: {
        surfaceId: 'forecast',
        path: `/bucket-${index}`,
        value: Array.from({ length: 40 }, () => 0),
      },
    }))
    const part = createPart({
      messages: [
        {
          version: 'v0.9.1',
          createSurface: {
            surfaceId: 'forecast',
            catalogId: 'https://dify.ai/a2ui/catalog/v1',
          },
        },
        ...updates,
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(part)).toEqual(part)
    expect(buildUISurfaces(part.messages)).toEqual({
      surfaces: [],
      error: 'invalid_data_model_update',
    })
  })

  it('rejects a nested index-1000 patch that would create sparse arrays', () => {
    const part = createPart({
      messages: [
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
            value: { items: [] },
          },
        },
        {
          version: 'v0.9.1',
          updateDataModel: {
            surfaceId: 'forecast',
            path: '/items/1000/1000',
            value: 'amplified',
          },
        },
        {
          version: 'v0.9.1',
          updateComponents: {
            surfaceId: 'forecast',
            components: [{ id: 'root', component: 'Text', text: 'Forecast' }],
          },
        },
      ],
    })

    expect(parseUIPartEnvelope(part)).toEqual(part)
    expect(buildUISurfaces(part.messages)).toEqual({
      surfaces: [],
      error: 'invalid_data_model_update',
    })
  })

  it('resolves escaped JSON Pointer segments without traversing unsafe keys', () => {
    const model = {
      'weather/current': {
        '~value': 31,
      },
    }

    expect(resolveJSONPointer(model, '/weather~1current/~0value')).toBe(31)
    expect(resolveJSONPointer(model, '/__proto__/polluted')).toBeUndefined()
    expect(resolveJSONPointer(model, 'weather/current')).toBeUndefined()
  })
})
