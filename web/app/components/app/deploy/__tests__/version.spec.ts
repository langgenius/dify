import { toDeploymentVersion } from '../version'

describe('toDeploymentVersion', () => {
  it('maps workflow metadata into the shared deployment version shape', () => {
    expect(
      toDeploymentVersion(
        {
          created_at: 1_710_000_100,
          created_by: { name: 'Ada' },
          environments: [{ name: 'Staging' }],
          id: 'workflow-1',
          marked_comment: 'Ready to deploy',
          version_number: 4,
        },
        'Default',
        'workflow-1',
      ),
    ).toEqual({
      description: 'Ready to deploy',
      id: 'workflow-1',
      latest: true,
      name: '# 4',
      publishedAt: 1_710_000_100_000,
      publishedBy: 'Ada',
      tags: ['Staging'],
    })
  })

  it('keeps optional deployment metadata absent when the source does not provide it', () => {
    expect(toDeploymentVersion({ id: 'workflow-2' }, 'Default')).toEqual({
      description: undefined,
      id: 'workflow-2',
      name: 'Default',
    })
  })
})
