#!/usr/bin/env python3
"""Smart resolve merge conflicts for #36842."""
import re, os

dify_dir = os.path.expanduser("~/dify-fork")
os.chdir(dify_dir)

def resolve_file(filepath):
    with open(filepath) as f:
        content = f.read()
    
    original = content
    
    # Replace conflict markers for simple conflicts (keep HEAD)
    # For complex ones, handle individually
    
    # billing/billing.py: Keep HEAD but add db import + pass db.session where upstream added it
    if "billing/billing.py" in filepath:
        # Conflict 1: import db - KEEP db import (upstream's change requires it)
        content = content.replace(
            "<<<<<<< HEAD\n=======\nfrom extensions.ext_database import db\n>>>>>>> upstream/main",
            "from extensions.ext_database import db"
        )
        # Conflict 2: is_tenant_owner_or_admin - use db.session (upstream API changed)
        content = content.replace(
            "<<<<<<< HEAD\n        BillingService.is_tenant_owner_or_admin(current_user)\n=======\n        BillingService.is_tenant_owner_or_admin(db.session, current_user)\n>>>>>>> upstream/main",
            "        BillingService.is_tenant_owner_or_admin(db.session, current_user)"
        )
        # Conflict 3: blank line in put method - keep
        content = content.replace(
            "<<<<<<< HEAD\n\n=======\n>>>>>>> upstream/main",
            ""
        )
    
    # billing/compliance.py: check conflicts
    elif "billing/compliance.py" in filepath:
        content = content.replace(
            "<<<<<<< HEAD\n=======\nfrom extensions.ext_database import db\n>>>>>>> upstream/main",
            "from extensions.ext_database import db"
        )
    
    # load_balancing_config.py: check
    elif "load_balancing_config.py" in filepath:
        content = content.replace(
            "<<<<<<< HEAD\n=======\nfrom extensions.ext_database import db\n>>>>>>> upstream/main",
            "from extensions.ext_database import db"
        )
        content = content.replace(
            "<<<<<<< HEAD\n        current_user, current_tenant_id = current_account_with_tenant()\n=======\n        current_user, current_tenant_id = current_account_with_tenant()\n        \n>>>>>>> upstream/main",
            "        current_user, current_tenant_id = current_account_with_tenant()"
        )
    
    # test_agent_providers.py: keep HEAD (our clean tests)
    elif "test_agent_providers.py" in filepath:
        content = re.sub(
            r'<<<<<<< HEAD\n(.*?)\n=======\n.*?\n>>>>>>> upstream/main',
            r'\1',
            content,
            flags=re.DOTALL
        )
    
    # test_billing.py: keep HEAD (our unwrap approach)
    elif "test_billing.py" in filepath:
        content = re.sub(
            r'<<<<<<< HEAD\n(.*?)\n=======\n.*?\n>>>>>>> upstream/main',
            r'\1',
            content,
            flags=re.DOTALL
        )
    
    # test_load_balancing_config.py: complex - check
    elif "test_load_balancing_config.py" in filepath:
        content = re.sub(
            r'<<<<<<< HEAD\n(.*?)\n=======\n.*?\n>>>>>>> upstream/main',
            r'\1',
            content,
            flags=re.DOTALL
        )
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"✅ Resolved {filepath.split('/')[-1]}")
    else:
        print(f"⚠️ No changes in {filepath.split('/')[-1]}")

# Find all conflict files
import subprocess
r = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"], capture_output=True, text=True)
for f in r.stdout.strip().split("\n"):
    if f:
        resolve_file(os.path.join(dify_dir, f))
