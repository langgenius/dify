from pdf_extract_kit.registry.registry import TASK_REGISTRY
from pdf_extract_kit.tasks.base_task import BaseTask


@TASK_REGISTRY.register("formula_recognition")
class FormulaRecognitionTask(BaseTask):
    def __init__(self, model):
        super().__init__(model)

    def predict(self, input_data, result_path, bboxes=None):
        images = self.load_images(input_data)
        # Perform recognition
        return self.model.predict(images, result_path)