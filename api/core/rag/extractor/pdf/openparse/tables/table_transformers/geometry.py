from __future__ import annotations


def calc_bbox_intersection(bbox1, bbox2, safety_margin=5.0):
    if safety_margin < 0:
        raise ValueError("Safety margin cannot be negative.")

    if (
            bbox1[2] <= bbox1[0]
            or bbox1[3] <= bbox1[1]
            or bbox2[2] <= bbox2[0]
            or bbox2[3] <= bbox2[1]
    ):
        raise ValueError("Bounding boxes must have non-zero width and height.")

    # Expand bounding boxes
    x1_expanded_min = min(bbox1[0], bbox2[0]) - safety_margin
    y1_expanded_min = min(bbox1[1], bbox2[1]) - safety_margin
    x2_expanded_max = max(bbox1[2], bbox2[2]) + safety_margin
    y2_expanded_max = max(bbox1[3], bbox2[3]) + safety_margin

    # Check if expanded boxes intersect
    if (
            x2_expanded_max <= max(bbox1[0], bbox2[0])
            or x1_expanded_min >= min(bbox1[2], bbox2[2])
            or y2_expanded_max <= max(bbox1[1], bbox2[1])
            or y1_expanded_min >= min(bbox1[3], bbox2[3])
    ):
        return None

    # Calculate and return the actual intersection based on original boxes
    x1 = max(bbox1[0], bbox2[0])
    y1 = max(bbox1[1], bbox2[1])
    x2 = min(bbox1[2], bbox2[2])
    y2 = min(bbox1[3], bbox2[3])

    # Only return the intersection if it's valid
    if x2 > x1 and y2 > y1:
        return (x1, y1, x2, y2)

    return None
