import type { Pagination } from '@dify/contracts/enterprise/types.gen'

export const DEPLOYMENT_PAGE_SIZE = 100
export const RELEASE_HISTORY_PAGE_SIZE = 20
export const SOURCE_APPS_PAGE_SIZE = 100

export function getNextPageParamFromPagination(pagination?: Pagination) {
  const currentPage = pagination?.currentPage ?? 1
  const totalPages = pagination?.totalPages ?? 1

  return currentPage < totalPages ? currentPage + 1 : undefined
}
