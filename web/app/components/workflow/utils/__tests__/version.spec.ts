import { getWorkflowVersionName } from '../version'

describe('getWorkflowVersionName', () => {
  it('prefers a marked name over the version number', () => {
    expect(
      getWorkflowVersionName(
        {
          marked_name: 'Production',
          version_number: 7,
        },
        'Untitled Version',
      ),
    ).toBe('Production')
  })

  it('uses the version number when the marked name is empty', () => {
    expect(
      getWorkflowVersionName(
        {
          marked_name: '',
          version_number: 7,
        },
        'Untitled Version',
      ),
    ).toBe('# 7')
  })

  it('uses the default name for legacy versions without a version number', () => {
    expect(
      getWorkflowVersionName(
        {
          marked_name: '',
          version_number: null,
        },
        'Untitled Version',
      ),
    ).toBe('Untitled Version')
  })
})
