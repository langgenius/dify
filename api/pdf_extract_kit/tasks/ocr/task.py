import os
import json
import random
from PIL import Image, ImageDraw
from pdf_extract_kit.registry.registry import TASK_REGISTRY
from pdf_extract_kit.utils.data_preprocess import load_pdf
from pdf_extract_kit.tasks.base_task import BaseTask


@TASK_REGISTRY.register("ocr")
class OCRTask(BaseTask):
    def __init__(self, model):
        """init the task based on the given model.
        
        Args:
            model: task model, must contains predict function.
        """
        super().__init__(model)

    def predict_image(self, image):
        """predict on one image, reture text detection and recognition results.
        
        Args:
            image: PIL.Image.Image, (if the model.predict function support other types, remenber add change-format-function in model.predict)
            
        Returns:
            List[dict]: list of text bbox with it's content
            
        Return example:
            [
                {
                    "category_type": "text",
                    "poly": [
                        380.6792698635707,
                        159.85058512958923,
                        765.1419999999998,
                        159.85058512958923,
                        765.1419999999998,
                        192.51073013642917,
                        380.6792698635707,
                        192.51073013642917
                    ],
                    "text": "this is an example text",
                    "score": 0.97
                },
                ...
            ]
        """
        return self.model.predict(image)
        
    def prepare_input_files(self, input_path):
        if os.path.isdir(input_path):
            file_list = [os.path.join(input_path, fname) for fname in os.listdir(input_path)]
        else:
            file_list = [input_path]
        return file_list
            
    def process(self, input_path, save_dir=None, visualize=False):
        file_list = self.prepare_input_files(input_path)
        res_list = []
        for fpath in file_list:
            basename = os.path.basename(fpath)[:-4]
            if fpath.endswith(".pdf") or fpath.endswith(".PDF"):
                images = load_pdf(fpath)
                pdf_res = []
                for page, img in enumerate(images):
                    page_res = self.predict_image(img)
                    pdf_res.append(page_res)
                    if save_dir:
                        os.makedirs(os.path.join(save_dir, basename), exist_ok=True)
                        self.save_json_result(page_res, os.path.join(save_dir, basename, f"page_{page+1}.json"))
                        if visualize:
                            self.visualize_image(img, page_res, os.path.join(save_dir, basename, f"page_{page+1}.jpg"))
                        
                res_list.append(pdf_res)
            else:
                image = Image.open(fpath)
                img_res = self.predict_image(image)
                res_list.append(img_res)
                if save_dir:
                    os.makedirs(save_dir, exist_ok=True)
                    self.save_json_result(img_res, os.path.join(save_dir, f"{basename}.json"))
                    if visualize:
                        self.visualize_image(image, img_res, os.path.join(save_dir, f"{basename}.png"))
                
        return res_list
    
    def visualize_image(self, image, ocr_res, save_path="", cate2color={}):
        """plot each result's bbox and category on image.
        
        Args:
            image: PIL.Image.Image
            ocr_res: list of ocr det and rec, whose format following the results of self.predict_image function
            save_path: path to save visualized image
        """
        draw = ImageDraw.Draw(image)
        for res in ocr_res:
            box_color = cate2color.get(res['category_type'], (0, 255, 0))
            x_min, y_min = int(res['poly'][0]), int(res['poly'][1])
            x_max, y_max = int(res['poly'][4]), int(res['poly'][5])
            draw.rectangle([x_min, y_min, x_max, y_max], fill=None, outline=box_color, width=1)
            draw.text((x_min, y_min), res['category_type'], (255, 0, 0))
        if save_path:
            image.save(save_path)
        
    def save_json_result(self, ocr_res, save_path):
        """save results to a json file.
        
        Args:
            ocr_res: list of ocr det and rec, whose format following the results of self.predict_image function
            save_path: path to save visualized image
        """
        with open(save_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(ocr_res, indent=2, ensure_ascii=False))
        
        
