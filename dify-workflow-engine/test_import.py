import sys
import os

# Add the current directory to sys.path
sys.path.append(os.getcwd())

try:
    from core.workflow.workflow_entry import WorkflowEntry
    print("Import successful!")
except ImportError as e:
    print(f"Import failed: {e}")
except Exception as e:
    print(f"An error occurred: {e}")
