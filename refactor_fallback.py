import os
import re

dify_path = '/Users/jashwanth/Desktop/work/oss/dify_expert/api'

def refactor_file(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    if 'get_account_by_email_with_case_fallback' not in content:
        return

    # Don't refactor the method definition in account_service.py itself
    # Wait, we already replaced account_service.py. It has `def get_account_by_email_with_case_fallback(session: Session, email: str) -> Account | None:`
    # We only want to refactor calls.
    # regex to match: AccountService.get_account_by_email_with_case_fallback(...)
    # Note: testing code might use patch(...) so we shouldn't touch strings.
    new_content = re.sub(
        r'AccountService\.get_account_by_email_with_case_fallback\(\s*(?!db\.session)([^)]+)\)',
        r'AccountService.get_account_by_email_with_case_fallback(db.session, \1)',
        content
    )
    
    if new_content != content:
        # check if db is imported
        if 'from extensions.ext_database import db' not in new_content:
            # We must be careful where to insert the import, just adding at the top is usually fine for Python.
            # But let's insert it after other imports.
            new_content = 'from extensions.ext_database import db\n' + new_content
        with open(file_path, 'w') as f:
            f.write(new_content)
        print(f"Updated {file_path}")

for root, _, files in os.walk(dify_path):
    for f in files:
        if f.endswith('.py'):
            refactor_file(os.path.join(root, f))
