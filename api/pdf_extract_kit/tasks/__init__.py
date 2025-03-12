from pdf_extract_kit.tasks.base_task import BaseTask
from pdf_extract_kit.tasks.formula_detection.task import FormulaDetectionTask
from pdf_extract_kit.tasks.formula_recognition.task import FormulaRecognitionTask
from pdf_extract_kit.tasks.layout_detection.task import LayoutDetectionTask
from pdf_extract_kit.tasks.ocr.task import OCRTask
from pdf_extract_kit.tasks.table_parsing.task import TableParsingTask

from pdf_extract_kit.registry.registry import TASK_REGISTRY

__all__ = [
    "BaseTask",
    "LayoutDetectionTask",
    "FormulaRecognitionTask",
    "LayoutDetectionTask",
    "OCRTask",
    "TableParsingTask",
]

def load_task(name, cfg=None):
    """
    Example

    >>> task = load_task("formula_detection", cfg=None)
    """
    task_class = TASK_REGISTRY.get(name)
    task_instance = task_class(cfg)

    return task_instance
