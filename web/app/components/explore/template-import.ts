import type { AppImportPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { RecommendedAppDetailResponse } from '@dify/contracts/api/console/explore/types.gen'

type TemplateImportSource =
  | {
      mode: 'template'
      template_id: NonNullable<AppImportPayload['template_id']>
      version_id: NonNullable<AppImportPayload['version_id']>
    }
  | { mode: 'ifpkg-url'; package_url: NonNullable<AppImportPayload['package_url']> }
  | { mode: 'yaml-content'; yaml_content: NonNullable<AppImportPayload['yaml_content']> }

export function getTemplateImportSource(
  detail: RecommendedAppDetailResponse,
): TemplateImportSource {
  if (detail.mode === 'agent') {
    if (detail.version_id) {
      return { mode: 'template', template_id: detail.id, version_id: detail.version_id }
    }
    if (detail.package_url) {
      return { mode: 'ifpkg-url', package_url: detail.package_url }
    }
    throw new Error('Agent template has no import source')
  }

  if (!detail.export_data) throw new Error('Template has no export data')
  return { mode: 'yaml-content', yaml_content: detail.export_data }
}
