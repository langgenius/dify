import type { RecommendedAppDetailResponse } from '@dify/contracts/api/console/explore/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import { getTemplateImportSource } from '../template-import'

const detail = {
  id: 'template-id',
  name: 'Template',
  mode: 'agent',
  can_trial: false,
  export_data: '',
} satisfies RecommendedAppDetailResponse

describe('getTemplateImportSource', () => {
  it('imports a catalog Agent from its published version', () => {
    expect(getTemplateImportSource({ ...detail, version_id: 'version-id' })).toEqual({
      mode: 'template',
      template_id: 'template-id',
      version_id: 'version-id',
    })
  })

  it('imports a remote Agent from its package URL', () => {
    expect(
      getTemplateImportSource({ ...detail, package_url: 'https://example.com/agent.ifpkg' }),
    ).toEqual({
      mode: 'ifpkg-url',
      package_url: 'https://example.com/agent.ifpkg',
    })
  })

  it('does not submit an empty YAML payload for an Agent', () => {
    expect(() => getTemplateImportSource(detail)).toThrow('Agent template has no import source')
  })

  it('preserves YAML import for existing app templates', () => {
    expect(
      getTemplateImportSource({ ...detail, mode: 'workflow', export_data: 'app: example' }),
    ).toEqual({
      mode: 'yaml-content',
      yaml_content: 'app: example',
    })
  })
})
