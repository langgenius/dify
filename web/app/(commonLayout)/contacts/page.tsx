import { ContactsDirectoryPage } from '@/features/contacts/management/directory-page'
import { isContactsManagementEnabled } from '@/features/contacts/management/feature-flag'
import { notFound } from '@/next/navigation'

export default function ContactsPage() {
  if (!isContactsManagementEnabled()) notFound()
  return <ContactsDirectoryPage />
}
