from blinker import signal

# sender: tenant
tenant_was_created = signal("tenant-was-created")

# sender: tenant
tenant_was_updated = signal("tenant-was-updated")

# sender: WorkspaceMemberRemovalRequest, kwargs: session (the open removal transaction)
workspace_member_will_be_removed = signal("workspace-member-will-be-removed")
