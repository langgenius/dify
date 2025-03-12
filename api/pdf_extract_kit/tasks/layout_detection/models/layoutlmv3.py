import os
import cv2
import numpy as np
from PIL import Image

from pdf_extract_kit.registry.registry import MODEL_REGISTRY
from pdf_extract_kit.utils.visualization import visualize_bbox

from .layoutlmv3_util.model_init import Layoutlmv3_Predictor

@MODEL_REGISTRY.register("layout_detection_layoutlmv3")
class LayoutDetectionLayoutlmv3:
    def __init__(self, config):
        """
        Initialize the LayoutDetectionYOLO class.

        Args:
            config (dict): Configuration dictionary containing model parameters.
        """
        # Mapping from class IDs to class names
        self.id_to_names = {
            0: 'title', 
            1: 'plain text',
            2: 'abandon', 
            3: 'figure', 
            4: 'figure_caption', 
            5: 'table', 
            6: 'table_caption', 
            7: 'table_footnote', 
            8: 'isolate_formula', 
            9: 'formula_caption'
        }
        self.model = Layoutlmv3_Predictor(config.get('model_path', None))
        self.visualize = config.get('visualize', False)

    def predict(self, images, result_path, image_ids=None):
        """
        Predict layouts in images.

        Args:
            images (list): List of images to be predicted.
            result_path (str): Path to save the prediction results.
            image_ids (list, optional): List of image IDs corresponding to the images.

        Returns:
            list: List of prediction results.
        """
        if not os.path.exists(result_path):
            os.makedirs(result_path)
        
        results = []
        for idx, im_file in enumerate(images):
            if isinstance(im_file, Image.Image):
                im = im_file.convert("RGB")  # extracted PDF pages
            elif isinstance(im_file, str):
                im = Image.open(im_file).convert("RGB")  # image path
            layout_res = self.model(np.array(im), ignore_catids=[])
            poly = np.array([det["poly"] for det in layout_res["layout_dets"]])
            boxes = poly[:, [0,1,4,5]] 
            scores = np.array([det["score"] for det in layout_res["layout_dets"]])
            classes = np.array([det["category_id"] for det in layout_res["layout_dets"]])
            
            if self.visualize:
                vis_result = visualize_bbox(im_file, boxes, classes, scores, self.id_to_names)
                # Determine the base name of the image
                if image_ids:
                    base_name = image_ids[idx]
                else:
                    base_name = os.path.splitext(os.path.basename(im_file))[0]  # Remove file extension
                result_name = f"{base_name}_layout.png"
                # Save the visualized result                
                cv2.imwrite(os.path.join(result_path, result_name), vis_result)

            # append result
            results.append({
                "im_path": im_file,
                "boxes": boxes,
                "scores": scores,
                "classes": classes,
            })
        return results
