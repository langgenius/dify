# Contacts Management Figma Acceptance Matrix

The Figma file is named Agent Roster, but every surface below belongs to the
Contacts frontend domain. Agent Roster and workspace Members remain separate
owners; Members composes only the removal-impact confirmation.

| Node         | Surface                       | Acceptance baseline                                                                                                                                                                                                                                 |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1294:64487` | Directory                     | Full-page Contacts route with title, help link, All / Workspace / External filters, search, Add external contact, and rows for name, email, type, channel summary, and joined date.                                                                 |
| `1282:62739` | Directory with details        | Keep the current directory visible and open a 320px right detail panel. Search, filter, and pagination context remain unchanged while the panel is open. Bulk removal controls shown in the design are outside this change.                         |
| `1459:32284` | Contact details               | Gradient identity header, avatar, name, email, kind badge, channel summaries, and joined metadata. The panel is read-only in this change.                                                                                                           |
| `1515:3382`  | Contact details menu          | The design exposes edit/remove affordances. They are intentionally omitted because this change has no typed actions for editing, deleting, merging, or overriding IM identities.                                                                    |
| `1303:66983` | External contact dialog       | 480px dialog with title, close control, identity preview, display name, required email, Cancel, and Add actions.                                                                                                                                    |
| `1303:67192` | External contact filled state | Preserve entered name/email while validation or a recoverable mutation result is shown.                                                                                                                                                             |
| `1303:67388` | External contact ready state  | Disable duplicate submission while pending; success closes the dialog, clears the draft, refreshes the active directory query, and restores focus to the trigger.                                                                                   |
| `1649:8221`  | Bind IM identity              | Cross-change reference only. Workspace IM overrides belong to `add-im-platform-binding-ui` and are not implemented or stored by this repository.                                                                                                    |
| `1459:31142` | EE directory                  | Add Platform filter and an Add contact menu with Add from Platform and External contact. Enterprise-wide candidates never appear in the ordinary directory until explicitly added.                                                                  |
| `1459:32562` | Organization picker           | Search Organization members, exclude existing contacts, keep explicit selection, and add one or more candidates as Platform contacts. The approved OpenSpec multi-select behavior takes precedence over the inspected single-select visual variant. |
| `1515:3696`  | EE member removal             | One 480px confirmation dialog with member identity, impact warning, and a `Keep as Platform contact` checkbox. The checkbox defaults to selected.                                                                                                   |
| `1649:5297`  | CE / SaaS member removal      | One 480px confirmation dialog with member identity and a non-optional warning that the workspace contact is also removed. No retention control is shown.                                                                                            |

## Responsive and accessibility baseline

- The directory uses horizontal scrolling for its tabular columns and stacks
  toolbar actions on narrow widths without hiding search or primary actions.
- The detail panel uses the available viewport width up to 320px.
- Dialogs fit the viewport with 16px outer margins and scroll their content
  when necessary.
- All interactive rows and controls have names, visible focus, keyboard access,
  associated field errors, announced result/error states, and overlay focus
  restoration.

## Mount and composition boundaries

- Route: `/contacts`, mounted under the common console layout and visible only
  when the Contacts preview gate is enabled and the mock context allows viewing.
- Deployment: CE, SaaS, and EE share the page shell. Only EE mounts the
  Organization picker, Platform filter, and member-retention choice.
- Permission context: `canViewContacts`, `canManageContacts`, and
  `canManageMembers` are UI-only mock capabilities derived at the composition
  root; they are not an authorization boundary.
- State: directory/details/external-contact/member-impact use one Contacts-owned
  typed mock repository. IM platform management keeps its existing independent
  repository; the two features share only workspace/deployment navigation
  context.
- Gate fallback: when the gate is disabled, `/contacts` and its navigation entry
  are unavailable and Members continues to call the existing production member
  removal flow.
