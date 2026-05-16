#!/usr/bin/env python3
"""
Refactor script to replace int(xxx.timestamp()) with to_timestamp(xxx)
Phase 1: services/ and repositories/ directories only
"""

import re
from pathlib import Path

# Target directories for Phase 1
TARGET_DIRS = ["services", "repositories"]

def needs_helper_import(content: str) -> bool:
    """Check if file already imports to_timestamp from libs.helper"""
    patterns = [
        r'from libs\.helper import.*to_timestamp',
        r'from libs import helper',
    ]
    return not any(re.search(p, content) for p in patterns)

def add_helper_import(content: str) -> str:
    """Add to_timestamp import to the file"""
    lines = content.split('\n')
    
    # Find the last import line
    last_import_idx = -1
    for i, line in enumerate(lines):
        if line.startswith('import ') or line.startswith('from '):
            last_import_idx = i
    
    if last_import_idx == -1:
        # No imports found, add at the beginning
        lines.insert(0, 'from libs.helper import to_timestamp')
    else:
        # Add after the last import
        lines.insert(last_import_idx + 1, 'from libs.helper import to_timestamp')
    
    return '\n'.join(lines)

def refactor_timestamp_calls(content: str) -> tuple[str, int]:
    """Replace int(xxx.timestamp()) with to_timestamp(xxx)"""
    
    # Pattern to match int(xxx.timestamp())
    # This handles various cases like:
    # - int(datetime.timestamp())
    # - int(obj.created_at.timestamp())
    # - int((datetime.now() + timedelta()).timestamp())
    
    count = 0
    
    # Pattern 1: Simple case - int(xxx.timestamp())
    pattern1 = r'int\(([^)]+)\.timestamp\(\)\)'
    def replace1(match):
        nonlocal count
        count += 1
        expr = match.group(1)
        return f'to_timestamp({expr})'
    
    content = re.sub(pattern1, replace1, content)
    
    return content, count

def process_file(file_path: Path) -> dict:
    """Process a single Python file"""
    try:
        content = file_path.read_text()
        original_content = content
        
        # Check if file has timestamp patterns
        if 'int(' not in content or '.timestamp()' not in content:
            return {'status': 'skipped', 'reason': 'no patterns found'}
        
        # Refactor timestamp calls
        content, count = refactor_timestamp_calls(content)
        
        if count == 0:
            return {'status': 'skipped', 'reason': 'no changes needed'}
        
        # Add import if needed
        if needs_helper_import(content):
            content = add_helper_import(content)
        
        # Write back
        file_path.write_text(content)
        
        return {
            'status': 'success',
            'changes': count,
            'file': str(file_path)
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'file': str(file_path)
        }

def main():
    api_path = Path.home() / "workspace" / "dify" / "api"
    
    results = {
        'success': [],
        'skipped': [],
        'error': []
    }
    
    for target_dir in TARGET_DIRS:
        dir_path = api_path / target_dir
        if not dir_path.exists():
            print(f"⚠️  Directory not found: {dir_path}")
            continue
        
        print(f"\n📁 Processing {target_dir}/")
        print("=" * 60)
        
        for py_file in dir_path.rglob("*.py"):
            # Skip __pycache__ and test files for now
            if '__pycache__' in str(py_file):
                continue
            
            result = process_file(py_file)
            
            if result['status'] == 'success':
                rel_path = py_file.relative_to(api_path)
                print(f"✅ {rel_path}: {result['changes']} changes")
                results['success'].append(result)
            elif result['status'] == 'error':
                print(f"❌ {py_file.name}: {result['error']}")
                results['error'].append(result)
            else:
                results['skipped'].append(result)
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 Summary:")
    print(f"  ✅ Success: {len(results['success'])} files")
    print(f"  ⏭️  Skipped: {len(results['skipped'])} files")
    print(f"  ❌ Errors: {len(results['error'])} files")
    
    total_changes = sum(r['changes'] for r in results['success'])
    print(f"\n  Total changes: {total_changes}")

if __name__ == '__main__':
    main()
