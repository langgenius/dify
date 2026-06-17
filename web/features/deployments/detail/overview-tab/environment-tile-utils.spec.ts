import type { TFunction } from 'i18next'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import {
  renderActionLabel,
  renderDriftTitle,
  renderStatus,
  resolveConfig,
} from './environment-tile-utils'

const t = ((key: string, options?: Record<string, unknown>) => {
  return options ? `${key}:${JSON.stringify(options)}` : key
}) as TFunction<'deployments'>

describe('resolveConfig', () => {
  it('treats undeploying environments as in progress', () => {
    const config = resolveConfig({
      drift: { kind: 'up-to-date' },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
      hasAnyRelease: true,
      latestId: 'release-2',
      currentReleaseId: 'release-1',
    })

    expect(config.kind).toBe('deploying')
    expect(config.status).toBe(RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING)
    expect(config.intent).toBe('navigate')
  })

  it('disables empty environments when no release exists', () => {
    const config = resolveConfig({
      drift: { kind: 'undeployed' },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
      hasAnyRelease: false,
      latestId: undefined,
      currentReleaseId: undefined,
    })

    expect(config.kind).toBe('empty')
    expect(config.intent).toBe('disabled')
    expect(config.showRelease).toBe(false)
    expect(config.releaseId).toBeUndefined()
  })

  it('opens deploy drawer for undeployed environments when a release exists', () => {
    const config = resolveConfig({
      drift: { kind: 'undeployed' },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
      hasAnyRelease: true,
      latestId: 'release-2',
      currentReleaseId: undefined,
    })

    expect(config.kind).toBe('empty')
    expect(config.intent).toBe('drawer')
    expect(config.releaseId).toBe('release-2')
  })

  it('resolves failed environments to the current release first', () => {
    const config = resolveConfig({
      drift: { kind: 'behind', steps: 1 },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED,
      hasAnyRelease: true,
      latestId: 'release-2',
      currentReleaseId: 'release-1',
    })

    expect(config.kind).toBe('failed')
    expect(config.intent).toBe('drawer')
    expect(config.releaseId).toBe('release-1')
  })

  it('resolves up-to-date and behind environments to drawer actions', () => {
    expect(resolveConfig({
      drift: { kind: 'up-to-date' },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
      hasAnyRelease: true,
      latestId: 'release-2',
      currentReleaseId: 'release-2',
    })).toMatchObject({
      kind: 'latest',
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
      intent: 'drawer',
      releaseId: 'release-2',
    })

    expect(resolveConfig({
      drift: { kind: 'behind', steps: 2 },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
      hasAnyRelease: true,
      latestId: 'release-3',
      currentReleaseId: 'release-1',
    })).toMatchObject({
      kind: 'behind',
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DRIFTED,
      intent: 'drawer',
      releaseId: 'release-3',
    })
  })

  it('treats unknown drift as an older release state', () => {
    const config = resolveConfig({
      drift: { kind: 'unknown' },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
      hasAnyRelease: true,
      latestId: 'release-3',
      currentReleaseId: 'release-1',
    })

    expect(config.kind).toBe('older')
    expect(config.status).toBe(RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNSPECIFIED)
    expect(config.intent).toBe('drawer')
    expect(config.releaseId).toBe('release-3')
  })
})

describe('environment tile copy helpers', () => {
  it('renders action labels for deployment states', () => {
    expect(renderActionLabel('empty', false, t)).toBe('overview.cardAction.deployLatest')
    expect(renderActionLabel('older', true, t)).toBe('overview.cardAction.deployLatest')
    expect(renderActionLabel('behind', true, t)).toBe('overview.cardAction.deployLatest')
    expect(renderActionLabel('latest', true, t)).toBe('overview.cardAction.redeploy')
    expect(renderActionLabel('deploying', true, t)).toBe('overview.cardAction.viewProgress')
    expect(renderActionLabel('failed', true, t)).toBe('overview.cardAction.redeploy')
    expect(renderActionLabel('failed', false, t)).toBe('overview.cardAction.deployLatest')
  })

  it('renders status labels and drift titles with counts when needed', () => {
    expect(renderStatus('empty', { kind: 'undeployed' }, t)).toBe('overview.chip.empty')
    expect(renderStatus('latest', { kind: 'up-to-date' }, t)).toBe('overview.chip.latest')
    expect(renderStatus('older', { kind: 'unknown' }, t)).toBe('overview.chip.olderRelease')
    expect(renderStatus('deploying', { kind: 'unknown' }, t)).toBe('overview.chip.deploying')
    expect(renderStatus('failed', { kind: 'unknown' }, t)).toBe('overview.chip.failed')
    expect(renderStatus('behind', { kind: 'behind', steps: 3 }, t)).toBe('overview.chip.behind:{"count":3}')

    expect(renderDriftTitle('latest', { kind: 'up-to-date' }, t)).toBe('overview.chip.latestTooltip')
    expect(renderDriftTitle('behind', { kind: 'behind', steps: 2 }, t)).toBe('overview.chip.behindTooltip:{"count":2}')
    expect(renderDriftTitle('older', { kind: 'unknown' }, t)).toBe('overview.chip.olderReleaseTooltip')
    expect(renderDriftTitle('empty', { kind: 'undeployed' }, t)).toBe('overview.chip.emptyTooltip')
    expect(renderDriftTitle('deploying', { kind: 'unknown' }, t)).toBe('overview.chip.deployingTooltip')
    expect(renderDriftTitle('failed', { kind: 'unknown' }, t)).toBe('overview.chip.failedTooltip')
  })
})
