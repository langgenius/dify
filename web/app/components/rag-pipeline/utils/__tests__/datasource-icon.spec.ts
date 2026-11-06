import { resolveDatasourceIcon } from '../datasource-icon'

vi.mock('@/utils/var', () => ({ basePath: '/dify' }))

it.each([
  ['/console/api/plugin/icon', '/dify/console/api/plugin/icon'],
  ['/dify/console/api/plugin/icon', '/dify/console/api/plugin/icon'],
  ['/dify', '/dify'],
  ['/dify-other/icon.svg', '/dify/dify-other/icon.svg'],
  ['https://assets.dify.ai/icon.svg', 'https://assets.dify.ai/icon.svg'],
  ['//assets.dify.ai/icon.svg', '//assets.dify.ai/icon.svg'],
  ['data:image/svg+xml,icon', 'data:image/svg+xml,icon'],
  ['icon.svg', 'icon.svg'],
  ['', ''],
])(
  'resolves datasource icon %s without changing external or already prefixed URLs',
  (icon, expected) => {
    expect(resolveDatasourceIcon(icon)).toBe(expected)
  },
)
