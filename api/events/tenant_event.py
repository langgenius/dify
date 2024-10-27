from blinker import signal

# sender: tenant
tenant_was_created = signal("tenant-was-created")

# sender: tenant
tenant_was_updated = signal("tenant-was-updated")
