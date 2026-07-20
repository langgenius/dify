import type {
  DeliveryMethod,
  EmailConfig,
  HumanInputNodeType,
  Recipient,
} from '../../human-input/types'
import type { HumanInputV2NodeType, HumanInputV2Recipient } from '../types'
import type {
  HumanInputMigrationBlocker,
  HumanInputMigrationGraph,
  HumanInputMigrationPlan,
  HumanInputMigrationResolverSnapshot,
} from './types'
import type { Node } from '@/app/components/workflow/types'
import { cloneDeep } from 'es-toolkit/object'
import { BlockEnum } from '@/app/components/workflow/types'
import { DeliveryMethodType } from '../../human-input/types'
import { classifyHumanInputVersion, HumanInputVersionKind } from './policy'
import { HumanInputMigrationBlockerCode } from './types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/

type RecipientAccumulator = {
  recipients: HumanInputV2Recipient[]
  canonicalKeys: Set<string>
}

type NodeConversionResult =
  | { status: 'ready'; data: HumanInputV2NodeType }
  | { status: 'blocked'; blockers: HumanInputMigrationBlocker[] }

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const isValidEmail = (email: string): boolean => EMAIL_PATTERN.test(email.trim())

const hasMaterialEmailConfig = (config?: EmailConfig): boolean => {
  if (!config) return false
  return Boolean(
    config.subject ||
    config.body ||
    config.debug_mode ||
    config.recipients?.whole_workspace ||
    config.recipients?.items?.length,
  )
}

const addRecipient = (
  accumulator: RecipientAccumulator,
  recipient: HumanInputV2Recipient,
  canonicalKey: string,
) => {
  if (accumulator.canonicalKeys.has(canonicalKey)) return
  accumulator.canonicalKeys.add(canonicalKey)
  accumulator.recipients.push(recipient)
}

const getContactByEmail = (snapshot: HumanInputMigrationResolverSnapshot, email: string) =>
  snapshot.contacts.find((contact) => normalizeEmail(contact.email) === normalizeEmail(email))

const addEmailRecipient = (
  accumulator: RecipientAccumulator,
  email: string,
  snapshot: HumanInputMigrationResolverSnapshot,
) => {
  const trimmedEmail = email.trim()
  const contact = getContactByEmail(snapshot, trimmedEmail)
  addRecipient(
    accumulator,
    contact
      ? { type: 'contact', contact_id: contact.id }
      : { type: 'onetime_email', email: trimmedEmail },
    `email:${normalizeEmail(trimmedEmail)}`,
  )
}

const addLegacyRecipient = (
  node: Node,
  method: DeliveryMethod,
  recipient: Recipient,
  snapshot: HumanInputMigrationResolverSnapshot,
  accumulator: RecipientAccumulator,
  blockers: HumanInputMigrationBlocker[],
) => {
  if (recipient.type === 'external') {
    const email = recipient.email?.trim() ?? ''
    if (!isValidEmail(email)) {
      blockers.push({
        nodeId: node.id,
        nodeTitle: node.data.title,
        code: HumanInputMigrationBlockerCode.InvalidEmail,
        methodId: method.id,
        value: recipient.email,
      })
      return
    }
    addEmailRecipient(accumulator, email, snapshot)
    return
  }

  const member = snapshot.members.find((candidate) => candidate.id === recipient.user_id)
  const email = member?.email?.trim() ?? ''
  if (!member || !isValidEmail(email)) {
    blockers.push({
      nodeId: node.id,
      nodeTitle: node.data.title,
      code: HumanInputMigrationBlockerCode.UnresolvedMember,
      methodId: method.id,
      value: recipient.user_id,
    })
    return
  }
  addEmailRecipient(accumulator, email, snapshot)
}

const addWholeWorkspaceRecipients = (
  node: Node,
  method: DeliveryMethod,
  snapshot: HumanInputMigrationResolverSnapshot,
  accumulator: RecipientAccumulator,
  blockers: HumanInputMigrationBlocker[],
) => {
  snapshot.members.forEach((member) => {
    const email = member.email?.trim() ?? ''
    if (!isValidEmail(email)) {
      blockers.push({
        nodeId: node.id,
        nodeTitle: node.data.title,
        code: HumanInputMigrationBlockerCode.UnresolvedMember,
        methodId: method.id,
        value: member.id,
      })
      return
    }
    addEmailRecipient(accumulator, email, snapshot)
  })
}

const convertNode = (
  node: Node,
  snapshot: HumanInputMigrationResolverSnapshot,
): NodeConversionResult => {
  const legacyData = node.data as HumanInputNodeType
  const blockers: HumanInputMigrationBlocker[] = []
  const accumulator: RecipientAccumulator = { recipients: [], canonicalKeys: new Set() }
  const enabledEmailConfigs: EmailConfig[] = []

  for (const method of legacyData.delivery_methods ?? []) {
    if (!method.enabled) {
      if (hasMaterialEmailConfig(method.config)) {
        blockers.push({
          nodeId: node.id,
          nodeTitle: node.data.title,
          code: HumanInputMigrationBlockerCode.ConfiguredDisabledMethod,
          methodId: method.id,
        })
      }
      continue
    }

    if (method.type === DeliveryMethodType.WebApp) {
      addRecipient(accumulator, { type: 'initiator' }, 'initiator')
      continue
    }

    if (method.type !== DeliveryMethodType.Email) {
      blockers.push({
        nodeId: node.id,
        nodeTitle: node.data.title,
        code: HumanInputMigrationBlockerCode.UnsupportedDeliveryMethod,
        methodId: method.id,
        value: method.type,
      })
      continue
    }

    const config = method.config
    if (!config || typeof config.subject !== 'string' || typeof config.body !== 'string') {
      blockers.push({
        nodeId: node.id,
        nodeTitle: node.data.title,
        code: HumanInputMigrationBlockerCode.InvalidEmailConfiguration,
        methodId: method.id,
      })
      continue
    }

    enabledEmailConfigs.push(config)
    for (const recipient of config.recipients?.items ?? [])
      addLegacyRecipient(node, method, recipient, snapshot, accumulator, blockers)
    if (config.recipients?.whole_workspace)
      addWholeWorkspaceRecipients(node, method, snapshot, accumulator, blockers)
  }

  const firstTemplate = enabledEmailConfigs[0]
  if (
    firstTemplate &&
    enabledEmailConfigs.some(
      (config) => config.subject !== firstTemplate.subject || config.body !== firstTemplate.body,
    )
  ) {
    blockers.push({
      nodeId: node.id,
      nodeTitle: node.data.title,
      code: HumanInputMigrationBlockerCode.ConflictingEmailTemplates,
    })
  }

  if (!accumulator.recipients.length) {
    blockers.push({
      nodeId: node.id,
      nodeTitle: node.data.title,
      code: HumanInputMigrationBlockerCode.MissingRecipients,
    })
  }

  if (blockers.length) return { status: 'blocked', blockers }

  const clonedData = cloneDeep(legacyData) as HumanInputNodeType & Record<string, unknown>
  const { delivery_methods: _deliveryMethods, ...sharedAndExtensionData } = clonedData
  const hasEmailDebugMode = enabledEmailConfigs.some((config) => config.debug_mode)

  return {
    status: 'ready',
    data: {
      ...sharedAndExtensionData,
      type: BlockEnum.HumanInput,
      version: '2',
      recpients_spec: accumulator.recipients,
      message_template: {
        subject: firstTemplate?.subject ?? '',
        body: firstTemplate?.body ?? '',
      },
      debug_mode: {
        enabled: hasEmailDebugMode,
        channels: hasEmailDebugMode ? ['email'] : [],
      },
    } as HumanInputV2NodeType,
  }
}

export const createHumanInputV2MigrationPlan = (
  graph: HumanInputMigrationGraph,
  snapshot: HumanInputMigrationResolverSnapshot,
): HumanInputMigrationPlan => {
  const replacements: Extract<HumanInputMigrationPlan, { status: 'ready' }>['replacements'] = []
  const blockers: HumanInputMigrationBlocker[] = []

  for (const node of graph.nodes) {
    const kind = classifyHumanInputVersion(node.data)
    if (kind === HumanInputVersionKind.V2 || kind === HumanInputVersionKind.NotHumanInput) continue

    if (kind === HumanInputVersionKind.LegacyBlocked) {
      blockers.push({
        nodeId: node.id,
        nodeTitle: node.data.title,
        code: HumanInputMigrationBlockerCode.UnsupportedVersion,
        value: String((node.data as { version?: unknown }).version),
      })
      continue
    }

    const result = convertNode(node, snapshot)
    if (result.status === 'blocked') blockers.push(...result.blockers)
    else replacements.push({ nodeId: node.id, data: result.data })
  }

  if (blockers.length) return { status: 'blocked', blockers }
  return { status: 'ready', replacements }
}

export const applyHumanInputV2MigrationPlan = (
  graph: HumanInputMigrationGraph,
  plan: Extract<HumanInputMigrationPlan, { status: 'ready' }>,
): HumanInputMigrationGraph => {
  if (!plan.replacements.length) return graph
  const replacements = new Map(
    plan.replacements.map((replacement) => [replacement.nodeId, replacement.data]),
  )

  return {
    nodes: graph.nodes.map((node) => {
      const data = replacements.get(node.id)
      return data ? { ...node, data } : node
    }),
    edges: graph.edges,
  }
}
