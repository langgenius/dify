import type {
  DatasourceCredentialListResponse,
  DatasourceProviderAuthListResponse,
} from '@dify/contracts/api/console/auth/types.gen'
import type { DataSourceAuth, DataSourceCredential } from './types'

// The data source UI types credential and OAuth schemas as auth form schemas and credential
// types as `CredentialTypeEnum`; the backend declares provider configs and plain strings.
export const selectDataSourceAuthList = (data: DatasourceProviderAuthListResponse) =>
  data as unknown as { result: DataSourceAuth[] }

export const selectDataSourceCredentials = (data: DatasourceCredentialListResponse) =>
  data as unknown as { result: DataSourceCredential[] }
