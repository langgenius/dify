from core.variables import SegmentType

EMPTY_VALUE_MAPPING = {
    SegmentType.STRING: "",
    SegmentType.NUMBER: 0,
    SegmentType.OBJECT: {},
    SegmentType.ARRAY_ANY: [],
    SegmentType.ARRAY_STRING: [],
    SegmentType.ARRAY_NUMBER: [],
    SegmentType.ARRAY_OBJECT: [],
}
