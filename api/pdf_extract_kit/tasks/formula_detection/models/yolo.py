import os
import cv2
import torch
from torch.utils.data import DataLoader, Dataset
from ultralytics import YOLO
from pdf_extract_kit.registry import MODEL_REGISTRY
from pdf_extract_kit.utils.visualization import visualize_bbox
from pdf_extract_kit.dataset.dataset import ImageDataset
import torchvision.transforms as transforms


@MODEL_REGISTRY.register('formula_detection_yolo')
class FormulaDetectionYOLO:
    def __init__(self, config):
        """
        Initialize the FormulaDetectionYOLO class.

        Args:
            config (dict): Configuration dictionary containing model parameters.
        """
        # Mapping from class IDs to class names
        self.id_to_names = {
            0: 'inline',
            1: 'isolated'
        }

        # Load the YOLO model from the specified path
        self.model = YOLO(config['model_path'])

        # Set model parameters
        self.img_size = config.get('img_size', 1280)
        self.pdf_dpi = config.get('pdf_dpi', 200)
        self.conf_thres = config.get('conf_thres', 0.25)
        self.iou_thres = config.get('iou_thres', 0.45)
        self.visualize = config.get('visualize', False)
        self.device = config.get('device', 'cuda' if torch.cuda.is_available() else 'cpu')
        self.batch_size = config.get('batch_size', 1)

    def predict(self, images, result_path, image_ids=None):
        """
        Predict formulas in images.

        Args:
            images (list): List of images to be predicted.
            result_path (str): Path to save the prediction results.
            image_ids (list, optional): List of image IDs corresponding to the images.

        Returns:
            list: List of prediction results.
        """
        results = []
        for idx, image in enumerate(images):
            result = self.model.predict(image, imgsz=self.img_size, conf=self.conf_thres, iou=self.iou_thres, verbose=False)[0]
            if self.visualize:
                if not os.path.exists(result_path):
                    os.makedirs(result_path)
                boxes = result.__dict__['boxes'].xyxy
                classes = result.__dict__['boxes'].cls
                scores = result.__dict__['boxes'].conf
                
                vis_result = visualize_bbox(image, boxes, classes, scores, self.id_to_names)

                # Determine the base name of the image
                if image_ids:
                    base_name = image_ids[idx]
                else:
                    # base_name = os.path.basename(image)                    
                    base_name = os.path.splitext(os.path.basename(image))[0]  # Remove file extension

                
                result_name = f"{base_name}_MFD.png"
                
                # Save the visualized result                
                cv2.imwrite(os.path.join(result_path, result_name), vis_result)
            results.append(result)
        return results