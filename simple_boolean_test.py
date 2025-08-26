#!/usr/bin/env python3
"""
Simple test to verify boolean classes can be imported correctly.
"""

import sys
import os

# Add the api directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))

try:
    # Test that we can import the boolean classes
    from core.variables.segments import BooleanSegment, ArrayBooleanSegment
    from core.variables.variables import BooleanVariable, ArrayBooleanVariable
    from core.variables.types import SegmentType

    print("✅ Successfully imported BooleanSegment")
    print("✅ Successfully imported ArrayBooleanSegment")
    print("✅ Successfully imported BooleanVariable")
    print("✅ Successfully imported ArrayBooleanVariable")
    print("✅ Successfully imported SegmentType")

    # Test that the segment types exist
    print(f"✅ SegmentType.BOOLEAN = {SegmentType.BOOLEAN}")
    print(f"✅ SegmentType.ARRAY_BOOLEAN = {SegmentType.ARRAY_BOOLEAN}")

    # Test creating boolean segments directly
    bool_seg = BooleanSegment(value=True)
    print(f"✅ Created BooleanSegment: {bool_seg}")
    print(f"   Value type: {bool_seg.value_type}")
    print(f"   Value: {bool_seg.value}")

    array_bool_seg = ArrayBooleanSegment(value=[True, False, True])
    print(f"✅ Created ArrayBooleanSegment: {array_bool_seg}")
    print(f"   Value type: {array_bool_seg.value_type}")
    print(f"   Value: {array_bool_seg.value}")

    print("\n🎉 All boolean class imports and basic functionality work correctly!")

except ImportError as e:
    print(f"❌ Import error: {e}")
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback

    traceback.print_exc()
