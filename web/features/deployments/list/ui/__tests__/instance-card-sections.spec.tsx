import type { Release } from '@dify/contracts/enterprise/types.gen'
import { ReleaseSource } from '@dify/contracts/enterprise/types.gen'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReleaseMetaTooltip } from '../instance-card-sections'

function createRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: 'release-1',
    appInstanceId: 'app-instance-1',
    displayName: 'Initial release',
    description: '',
    source: ReleaseSource.RELEASE_SOURCE_SOURCE_APP,
    sourceAppId: 'source-app-1',
    gateCommitId: 'commit-1',
    requiredSlots: [],
    createdBy: {
      id: 'user-1',
      displayName: 'Ada',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function closestWithClass(element: HTMLElement, className: string) {
  let current: HTMLElement | null = element

  while (current) {
    if (current.classList.contains(className))
      return current
    current = current.parentElement
  }

  return null
}

describe('ReleaseMetaTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should use compact typography for the release metadata preview', async () => {
    render(
      <ReleaseMetaTooltip release={createRelease()} deployed>
        <a href="/deployments/app-instance-1/releases">
          Initial release · 14 days ago
        </a>
      </ReleaseMetaTooltip>,
    )

    await act(async () => {
      fireEvent.mouseEnter(screen.getByRole('link', { name: 'Initial release · 14 days ago' }))
      await vi.advanceTimersByTimeAsync(700)
    })

    const previewValue = screen.getByText('Initial release')
    expect(closestWithClass(previewValue, 'min-w-48')).toHaveClass('system-xs-regular')
  })
})
