import type { Registry } from '@/auth/hosts'
import { ContextListOutput, ContextRow } from './handlers'

export function runAuthList(reg: Registry): ContextListOutput {
  const rows: ContextRow[] = []
  for (const [host, entry] of Object.entries(reg.hosts)) {
    for (const [email, ctx] of Object.entries(entry.accounts)) {
      const isActive = reg.current_host === host && entry.current_account === email
      rows.push(new ContextRow(host, email, ctx.account.name, isActive))
    }
  }
  return new ContextListOutput(rows)
}
