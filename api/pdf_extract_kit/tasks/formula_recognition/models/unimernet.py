import os
import logging
import argparse

import cv2
import torch
import numpy as np
from PIL import Image
import unimernet.tasks as tasks
from unimernet.common.config import Config
from unimernet.processors import load_processor

from pdf_extract_kit.registry import MODEL_REGISTRY


@MODEL_REGISTRY.register('formula_recognition_unimernet')
class FormulaRecognitionUniMERNet:
    def __init__(self, config):
        """
        Initialize the FormulaRecognitionUniMERNet class.

        Args:
            config (dict): Configuration dictionary containing model parameters.
        """
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model_dir = config['model_path']
        self.cfg_path = config.get('cfg_path', "pdf_extract_kit/configs/unimernet.yaml")
        self.batch_size = config.get('batch_size', 1)

        # Load the UniMERNet model
        self.model, self.vis_processor = self.load_model_and_processor()

    def load_model_and_processor(self):
        try:
            args = argparse.Namespace(cfg_path=self.cfg_path, options=None)
            cfg = Config(args)
            cfg.config.model.pretrained = os.path.join(self.model_dir, "pytorch_model.pth")
            cfg.config.model.model_config.model_name = self.model_dir
            cfg.config.model.tokenizer_config.path = self.model_dir
            task = tasks.setup_task(cfg)
            model = task.build_model(cfg).to(self.device)
            vis_processor = load_processor('formula_image_eval', cfg.config.datasets.formula_rec_eval.vis_processor.eval)
            return model, vis_processor
        except Exception as e:
            logging.error(f"Error loading model and processor: {e}")
            raise
    
    def predict(self, images, result_path):
        results = []
        for image_path in images:
            # Read the image using OpenCV
            open_cv_image = cv2.imread(image_path)
            if open_cv_image is None:
                logging.error(f"Error: Unable to open image at {image_path}")
                continue
            # Convert the OpenCV image to PIL.Image format
            raw_image = Image.fromarray(cv2.cvtColor(open_cv_image, cv2.COLOR_BGR2RGB))

            try:
                # Process the image using the visual processor and prepare it for the model
                image = self.vis_processor(raw_image).unsqueeze(0).to(self.device)

                # Generate the prediction using the model
                output = self.model.generate({"image": image})
                pred = output["pred_str"][0]
                logging.info(f'Prediction for {image_path}:\n{pred}')

                # cv2.imshow('Original Image', open_cv_image)
                # cv2.waitKey(0)
                # cv2.destroyAllWindows()

                results.append(pred)
            except Exception as e:
                logging.error(f"Error processing image {image_path}: {e}")
    
        return results