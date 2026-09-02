/**
 * Public server surface for the standalone Marketplace host (dify-marketplace).
 * Import this module instead of treating private Marketplace paths as Knip entries.
 */
import {
  adaptCreatorProfile,
  CREATOR_SORT_FIELDS,
  DEFAULT_CREATOR_SORT_FIELD,
  DEFAULT_CREATOR_SORT_ORDER,
  getStandaloneCreationHref,
  parseCreatorSortField,
  parseCreatorSortOrder,
  sortCreatorCreations,
  toPublisherSortQuery,
} from '../creator-profile/model'
import { HydrateQueryClient } from '../hydration-server'
import Marketplace from '../index'
import { SERVER_PREFETCH_BUDGET_MS, withinServerBudget } from '../server-budget'

export const standaloneMarketplaceServer = {
  Marketplace,
  HydrateQueryClient,
  SERVER_PREFETCH_BUDGET_MS,
  withinServerBudget,
  adaptCreatorProfile,
  CREATOR_SORT_FIELDS,
  DEFAULT_CREATOR_SORT_FIELD,
  DEFAULT_CREATOR_SORT_ORDER,
  getStandaloneCreationHref,
  parseCreatorSortField,
  parseCreatorSortOrder,
  sortCreatorCreations,
  toPublisherSortQuery,
}
