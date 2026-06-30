#!/usr/bin/env python3
"""Resolve merge conflicts for fix/36585-dep-inject-user-id-batch (#36842)."""
import re, os

dify_dir = os.path.expanduser("~/dify-fork")
os.chdir(dify_dir)

# Find all conflict files
import subprocess
r = subprocess.run(["git", "diff", "--name-only", "--diff-filter=U"], capture_output=True, text=True)
conflict_files = [f for f in r.stdout.strip().split("\n") if f]
print(f"Conflict files: {conflict_files}")

for filepath in conflict_files:
    print(f"\n{'='*60}")
    print(f"Processing: {filepath}")
    
    with open(filepath) as f:
        content = f.read()
    
    original = content
    
    # Strategy for each file:
    # - billing/billing.py: Keep upstream approach (with_session decorator) if they updated it, or keep our @with_current_user
    # - billing/compliance.py: Same
    # - load_balancing_config.py: Keep our @with_current_user but also keep upstream's changes if any
    # - test files: Keep our test approach (unwrap + mock_session), resolve their type hints
    # - agent_providers.py: Keep our version (already clean)
    
    # Simple keep HEAD side for all (our PR changes)
    pattern = re.compile(r'<<<<<<< HEAD\n(.*?)\n=======\n.*?\n>>>>>>> upstream/main', re.DOTALL)
    def keep_head(match):
        return match.group(1)
    
    new_content = pattern.sub(keep_head, content)
    
    if new_content != original:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"  ✅ Resolved (kept HEAD)")
    else:
        print(f"  ⚠️ No conflict markers found")
