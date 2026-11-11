import { useTranslation } from 'react-i18next'

export default function WorkspaceRole({ role }: { role: string | null }) {
  const { t } = useTranslation(['accountSettings'])
  switch (role) {
    case 'owner':
      return t(($) => $['personalAccessToken.roleOwner'])
    case 'admin':
      return t(($) => $['personalAccessToken.roleAdmin'])
    case 'editor':
      return t(($) => $['personalAccessToken.roleEditor'])
    case 'normal':
      return t(($) => $['personalAccessToken.roleMember'])
    case 'dataset_operator':
      return t(($) => $['personalAccessToken.roleDatasetOperator'])
    default:
      return '—'
  }
}
