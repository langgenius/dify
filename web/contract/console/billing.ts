import { type } from '@orpc/contract'
import { base } from '../base'

export const invoicesContract = base
  .route({
    path: '/billing/invoices',
    method: 'GET',
  })
  .input(type<unknown>())
  .output(type<{ url: string }>())

export const bindPartnerStackContract = base
  .route({
    path: '/billing/partners/{partnerKey}/tenants',
    method: 'PUT',
  })
  .input(type<{
    params: {
      partnerKey: string
    }
    body: {
      click_id: string
    }
  }>())
  .output(type<unknown>())
