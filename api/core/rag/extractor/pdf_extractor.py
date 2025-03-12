import os
import tempfile
import uuid
import requests
import mimetypes
import time
import gc
import re
import torch
from urllib.parse import urlparse
from pdf_extract_kit.utils.config_loader import load_config, initialize_tasks_and_models
from pdf_extract_kit.tasks.ocr.task import OCRTask
from pdf_extract_kit.dataset.dataset import MathDataset
from pdf_extract_kit.utils.merge_blocks_and_spans import fill_spans_in_blocks, fix_block_spans, merge_para_with_text
from pdf_extract_kit.utils.data_preprocess import load_pdf
from configs import dify_config
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.enums import CreatedByRole
from models.model import UploadFile
from core.rag.extractor.extractor_base import BaseExtractor
import datetime
import logging
from PIL import Image
from torch.utils.data import DataLoader
from torchvision import transforms

logger = logging.getLogger(__name__)

def latex_rm_whitespace(s: str):
    """Remove unnecessary whitespace from LaTeX code.
    """
    text_reg = r'(\\(operatorname|mathrm|text|mathbf)\s?\*? {.*?})'
    letter = '[a-zA-Z]'
    noletter = '[\W_^\d]'
    names = [x[0].replace(' ', '') for x in re.findall(text_reg, s)]
    s = re.sub(text_reg, lambda match: str(names.pop(0)), s)
    news = s
    while True:
        s = news
        news = re.sub(r'(?!\\ )(%s)\s+?(%s)' % (noletter, noletter), r'\1\2', s)
        news = re.sub(r'(?!\\ )(%s)\s+?(%s)' % (noletter, letter), r'\1\2', news)
        news = re.sub(r'(%s)\s+?(%s)' % (letter, noletter), r'\1\2', news)
        if news == s:
            break
    return s

def crop_img(input_res, input_pil_img, padding_x=0, padding_y=0):
    crop_xmin, crop_ymin = int(input_res['poly'][0]), int(input_res['poly'][1])
    crop_xmax, crop_ymax = int(input_res['poly'][4]), int(input_res['poly'][5])
    crop_new_width = crop_xmax - crop_xmin + padding_x * 2
    crop_new_height = crop_ymax - crop_ymin + padding_y * 2
    return_image = Image.new('RGB', (crop_new_width, crop_new_height), 'white')
    crop_box = (crop_xmin, crop_ymin, crop_xmax, crop_ymax)
    cropped_img = input_pil_img.crop(crop_box)
    return_image.paste(cropped_img, (padding_x, padding_y))
    return_list = [padding_x, padding_y, crop_xmin, crop_ymin, crop_xmax, crop_ymax, crop_new_width, crop_new_height]
    return return_image, return_list

class PdfExtractor(BaseExtractor):
    """Load PDF files and convert them to Markdown format.
    
    Args:
        file_path: Path to the file to load.
    """

    def __init__(self, file_path: str, tenant_id: str, user_id: str):
        """Initialize with file path."""
        self.file_path = file_path
        self.tenant_id = tenant_id
        self.user_id = user_id

        if "~" in self.file_path:
            self.file_path = os.path.expanduser(self.file_path)

        if not os.path.isfile(self.file_path) and self._is_valid_url(self.file_path):
            r = requests.get(self.file_path)
            if r.status_code != 200:
                raise ValueError(f"Check the url of your file; returned status code {r.status_code}")
            self.web_path = self.file_path
            self.temp_file = tempfile.NamedTemporaryFile(delete=False)
            self.temp_file.write(r.content)
            self.temp_file.flush()
            self.file_path = self.temp_file.name
        elif not os.path.isfile(self.file_path):
            raise ValueError(f"File path {self.file_path} is not a valid file or url")

        config_path = os.path.join("./pdf_extractor_config.yaml")
        config = load_config(config_path)
        task_instances = initialize_tasks_and_models(config)
        self.layout_model = task_instances['layout_detection'].model
        self.mfd_model = task_instances['formula_detection'].model
        self.mfr_model = task_instances['formula_recognition'].model
        self.ocr_model = task_instances['ocr'].model
        if self.mfr_model is not None:
            assert self.mfd_model is not None, "formula recognition based on formula detection, mfd_model can not be None."
            self.mfr_transform = transforms.Compose([self.mfr_model.vis_processor, ])

    def __del__(self) -> None:
        if hasattr(self, "temp_file"):
            self.temp_file.close()

    def extract(self) -> list[Document]:
        """Load given PDF file and convert it into a list of Documents."""
        content = self.parse_pdf(self.file_path)
        return [
            Document(
                page_content=content,
                metadata={"source": self.file_path},
            )
        ]

    @staticmethod
    def _is_valid_url(url: str) -> bool:
        """Check if the url is valid."""
        parsed = urlparse(url)
        return bool(parsed.netloc) and bool(parsed.scheme)

    def parse_pdf(self, pdf_path) -> str:
        """Parse the PDF document and convert it to markdown."""
        images = load_pdf(pdf_path)
        pdf_extract_res = self.process_single_pdf(images)
        md_content = []
        for image,extract_res in zip(images, pdf_extract_res):
            md_text = self.convert2md(extract_res,pil_image=image)
            md_content.append(md_text)
        return "\n\n".join(md_content)

    def process_single_pdf(self, image_list):
        pdf_extract_res = []
        mf_image_list = []
        latex_filling_list = []
        for idx, image in enumerate(image_list):
            img_W, img_H = image.size
            if self.layout_model is not None:
                ori_layout_res = self.layout_model.predict([image], "")[0]
                layout_res = self.convert_format(ori_layout_res, self.layout_model.id_to_names)
            else:
                layout_res = []
            single_page_res = {'layout_dets': layout_res}
            single_page_res['page_info'] = dict(
                page_no = idx,
                height = img_H,
                width = img_W
            )
            if self.mfd_model is not None:
                mfd_res = self.mfd_model.predict([image], "")[0]
                for xyxy, conf, cla in zip(mfd_res.boxes.xyxy.cpu(), mfd_res.boxes.conf.cpu(), mfd_res.boxes.cls.cpu()):
                    xmin, ymin, xmax, ymax = [int(p.item()) for p in xyxy]
                    new_item = {
                        'category_type': self.mfd_model.id_to_names[int(cla.item())],
                        'poly': [xmin, ymin, xmax, ymin, xmax, ymax, xmin, ymax],
                        'score': round(float(conf.item()), 2),
                        'latex': '',
                    }
                    single_page_res['layout_dets'].append(new_item)
                    if self.mfr_model is not None:
                        latex_filling_list.append(new_item)
                        bbox_img = image.crop((xmin, ymin, xmax, ymax))
                        mf_image_list.append(bbox_img)
                    
                pdf_extract_res.append(single_page_res)
                
                del mfd_res
                torch.cuda.empty_cache()
                gc.collect()

        if self.mfr_model is not None:
            dataset = MathDataset(mf_image_list, transform=self.mfr_transform)
            dataloader = DataLoader(dataset, batch_size=self.mfr_model.batch_size, num_workers=0)

            mfr_res = []
            for imgs in dataloader:
                imgs = imgs.to(self.mfr_model.device)
                output = self.mfr_model.model.generate({'image': imgs})
                mfr_res.extend(output['pred_str'])
            for res, latex in zip(latex_filling_list, mfr_res):
                res['latex'] = latex_rm_whitespace(latex)
        for idx, image in enumerate(image_list):
            layout_res = pdf_extract_res[idx]['layout_dets']
            pil_img = image.copy()

            ocr_res_list = []
            table_res_list = []
            single_page_mfdetrec_res = []

            for res in layout_res:
                if res['category_type'] in self.mfd_model.id_to_names.values():
                    single_page_mfdetrec_res.append({
                        "bbox": [int(res['poly'][0]), int(res['poly'][1]),
                                 int(res['poly'][4]), int(res['poly'][5])],
                    })
                elif res['category_type'] in [self.layout_model.id_to_names[cid] for cid in [0, 1, 2, 4, 6, 7]]:
                    ocr_res_list.append(res)
                elif res['category_type'] in [self.layout_model.id_to_names[5]]:
                    table_res_list.append(res)

            for res in ocr_res_list:
                new_image, useful_list = crop_img(res, pil_img, padding_x=25, padding_y=25)
                paste_x, paste_y, xmin, ymin, xmax, ymax, new_width, new_height = useful_list
                adjusted_mfdetrec_res = []
                for mf_res in single_page_mfdetrec_res:
                    mf_xmin, mf_ymin, mf_xmax, mf_ymax = mf_res["bbox"]
                    x0 = mf_xmin - xmin + paste_x
                    y0 = mf_ymin - ymin + paste_y
                    x1 = mf_xmax - xmin + paste_x
                    y1 = mf_ymax - ymin + paste_y
                    if any([x1 < 0, y1 < 0]) or any([x0 > new_width, y0 > new_height]):
                        continue
                    else:
                        adjusted_mfdetrec_res.append({
                            "bbox": [x0, y0, x1, y1],
                        })
                ocr_res = self.ocr_model.ocr(new_image, mfd_res=adjusted_mfdetrec_res)[0]
                if ocr_res:
                    for box_ocr_res in ocr_res:
                        p1, p2, p3, p4 = box_ocr_res[0]
                        text, score = box_ocr_res[1]
                        p1 = [p1[0] - paste_x + xmin, p1[1] - paste_y + ymin]
                        p2 = [p2[0] - paste_x + xmin, p2[1] - paste_y + ymin]
                        p3 = [p3[0] - paste_x + xmin, p3[1] - paste_y + ymin]
                        p4 = [p4[0] - paste_x + xmin, p4[1] - paste_y + ymin]

                        layout_res.append({
                            'category_type': 'text',
                            'poly': p1 + p2 + p3 + p4,
                            'score': round(score, 2),
                            'text': text,
                        })
        return pdf_extract_res

    def convert_format(self, yolo_res, id_to_names):
        """Convert yolo format to PDF-extract format."""
        res_list = []
        for xyxy, conf, cla in zip(yolo_res.boxes.xyxy.cpu(), yolo_res.boxes.conf.cpu(), yolo_res.boxes.cls.cpu()):
            xmin, ymin, xmax, ymax = [int(p.item()) for p in xyxy]
            new_item = {
                'category_type': id_to_names[int(cla.item())],
                'poly': [xmin, ymin, xmax, ymin, xmax, ymax, xmin, ymax],
                'score': round(float(conf.item()), 2),
            }
            res_list.append(new_item)
        return res_list

    def convert2md(self, extract_res, pil_image=None, img_save_dir="figures", basename="page"):
        blocks = []
        spans = []

        for item in extract_res['layout_dets']:
            if item['category_type'] in ['inline', 'text', 'isolated']:
                text_key = 'text' if item['category_type'] == 'text' else 'latex'
                xmin, ymin, _, _, xmax, ymax, _, _ = item['poly']
                spans.append({
                    "type": item['category_type'],
                    "bbox": [xmin, ymin, xmax, ymax],
                    "content": item[text_key]
                })
                if item['category_type'] == "isolated":
                    item['category_type'] = "isolate_formula"
                    blocks.append(item)
            else:
                blocks.append(item)

        blocks_types = ["title", "plain text", "figure_caption", "table_caption", "table_footnote", "isolate_formula", "formula_caption"]
        need_fix_bbox = []
        final_block = []
        for block in blocks:
            block_type = block["category_type"]
            if block_type in blocks_types:
                need_fix_bbox.append(block)
            else:
                final_block.append(block)

        block_with_spans, spans = fill_spans_in_blocks(need_fix_bbox, spans, 0.6)
        fix_blocks = fix_block_spans(block_with_spans)
        for para_block in fix_blocks:
            result = merge_para_with_text(para_block)
            if para_block['type'] == "isolate_formula":
                para_block['saved_info']['latex'] = result
            else:
                para_block['saved_info']['text'] = result
            final_block.append(para_block['saved_info'])

        final_block = self.order_blocks(final_block)
        md_text = ""
        for block in final_block:
            if block['category_type'] == "title":
                md_text += "\n# " + block['text'] + "\n"
            elif block['category_type'] in ["isolate_formula"]:
                md_text += "\n" + block['latex'] + "\n"
            elif block['category_type'] in ["plain text", "figure_caption", "table_caption"]:
                md_text += " " + block['text'] + " "
            elif block['category_type'] == "figure":
                if pil_image is not None:
                    xmin, ymin, _, _, xmax, ymax, _, _ = block['poly']
                    figure_img = pil_image.crop((xmin, ymin, xmax, ymax))
                    import io
                    buf = io.BytesIO()
                    figure_img.save(buf, format="PNG")
                    image_data = buf.getvalue()
                    buf.close()
                    file_uuid = str(uuid.uuid4())
                    file_key = f"image_files/{self.tenant_id}/{file_uuid}.png"
                    mime_type, _ = mimetypes.guess_type(file_key)
                    storage.save(file_key, image_data)
                    upload_file = UploadFile(
                        tenant_id=self.tenant_id,
                        storage_type=dify_config.STORAGE_TYPE,
                        key=file_key,
                        name=file_key,
                        size=len(image_data),
                        extension="png",
                        mime_type=mime_type or "",
                        created_by=self.user_id,
                        created_by_role=CreatedByRole.ACCOUNT,
                        created_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                        used=True,
                        used_by=self.user_id,
                        used_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                    )
                    db.session.add(upload_file)
                    db.session.commit()
                    img_url = f"{dify_config.CONSOLE_API_URL}/files/{upload_file.id}/file-preview"
                    md_text += f"\n![Figure]({img_url})\n"
            elif block['category_type'] == "table":
                if pil_image is not None:
                    xmin, ymin, _, _, xmax, ymax, _, _ = block['poly']
                    table_img = pil_image.crop((xmin, ymin, xmax, ymax))
                    import io
                    buf = io.BytesIO()
                    table_img.save(buf, format="PNG")
                    image_data = buf.getvalue()
                    buf.close()
                    file_uuid = str(uuid.uuid4())
                    file_key = f"image_files/{self.tenant_id}/{file_uuid}.png"
                    mime_type, _ = mimetypes.guess_type(file_key)
                    storage.save(file_key, image_data)
                    upload_file = UploadFile(
                        tenant_id=self.tenant_id,
                        storage_type=dify_config.STORAGE_TYPE,
                        key=file_key,
                        name=file_key,
                        size=len(image_data),
                        extension="png",
                        mime_type=mime_type or "",
                        created_by=self.user_id,
                        created_by_role=CreatedByRole.ACCOUNT,
                        created_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                        used=True,
                        used_by=self.user_id,
                        used_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                    )
                    db.session.add(upload_file)
                    db.session.commit()
                    img_url = f"{dify_config.CONSOLE_API_URL}/files/{upload_file.id}/file-preview"
                    md_text += f"\n![Table]({img_url})\n"
            else:
                continue
        print(md_text)
        return md_text


    def order_blocks(self, blocks):
        """Order the blocks based on their position on the page."""
        def calculate_order(poly):
            xmin, ymin, _, _, xmax, ymax, _, _ = poly
            return ymin * 3000 + xmin
        return sorted(blocks, key=lambda item: calculate_order(item['poly']))

    def save_image_to_db(self, image: Image.Image, ext: str = "png") -> str:
        """
        Save the PIL Image to unified storage, record the upload record in the database, 
        and return the image preview URL.
        """
        import io
        buf = io.BytesIO()
        image.save(buf, format=ext.upper())
        image_data = buf.getvalue()
        buf.close()

        file_uuid = str(uuid.uuid4())
        file_key = f"image_files/{self.tenant_id}/{file_uuid}.{ext}"
        mime_type, _ = mimetypes.guess_type(file_key)

        storage.save(file_key, image_data)

        upload_file = UploadFile(
            tenant_id=self.tenant_id,
            storage_type=dify_config.STORAGE_TYPE,
            key=file_key,
            name=file_key,
            size=len(image_data),
            extension=ext,
            mime_type=mime_type or "",
            created_by=self.user_id,
            created_by_role=CreatedByRole.ACCOUNT,
            created_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            used=True,
            used_by=self.user_id,
            used_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
        )
        db.session.add(upload_file)
        db.session.commit()

        img_url = f"{dify_config.CONSOLE_API_URL}/files/{upload_file.id}/file-preview"
        return img_url
