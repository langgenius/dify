import time
import copy
import logging
import base64
import cv2
import numpy as np
from io import BytesIO
from PIL import Image

from paddleocr import PaddleOCR
from ppocr.utils.logging import get_logger
from ppocr.utils.utility import check_and_read, alpha_to_color, binarize_img
from tools.infer.utility import draw_ocr_box_txt, get_rotate_crop_image, get_minarea_rect_crop
from pdf_extract_kit.registry import MODEL_REGISTRY
logger = get_logger()

def img_decode(content: bytes):
    np_arr = np.frombuffer(content, dtype=np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)

def check_img(img):
    if isinstance(img, bytes):
        img = img_decode(img)
    if isinstance(img, str):
        image_file = img
        img, flag_gif, flag_pdf = check_and_read(image_file)
        if not flag_gif and not flag_pdf:
            with open(image_file, 'rb') as f:
                img_str = f.read()
                img = img_decode(img_str)
            if img is None:
                try:
                    buf = BytesIO()
                    image = BytesIO(img_str)
                    im = Image.open(image)
                    rgb = im.convert('RGB')
                    rgb.save(buf, 'jpeg')
                    buf.seek(0)
                    image_bytes = buf.read()
                    data_base64 = str(base64.b64encode(image_bytes),
                                      encoding="utf-8")
                    image_decode = base64.b64decode(data_base64)
                    img_array = np.frombuffer(image_decode, np.uint8)
                    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
                except:
                    logger.error("error in loading image:{}".format(image_file))
                    return None
        if img is None:
            logger.error("error in loading image:{}".format(image_file))
            return None
    if isinstance(img, np.ndarray) and len(img.shape) == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if isinstance(img, Image.Image):
        img = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)
    return img

def sorted_boxes(dt_boxes):
    """
    Sort text boxes in order from top to bottom, left to right
    args:
        dt_boxes(array):detected text boxes with shape [4, 2]
    return:
        sorted boxes(array) with shape [4, 2]
    """
    num_boxes = dt_boxes.shape[0]
    sorted_boxes = sorted(dt_boxes, key=lambda x: (x[0][1], x[0][0]))
    _boxes = list(sorted_boxes)

    for i in range(num_boxes - 1):
        for j in range(i, -1, -1):
            if abs(_boxes[j + 1][0][1] - _boxes[j][0][1]) < 10 and \
                    (_boxes[j + 1][0][0] < _boxes[j][0][0]):
                tmp = _boxes[j]
                _boxes[j] = _boxes[j + 1]
                _boxes[j + 1] = tmp
            else:
                break
    return _boxes


def __is_overlaps_y_exceeds_threshold(bbox1, bbox2, overlap_ratio_threshold=0.8):
    """Check if two bounding boxes overlap on the y-axis, and if the height of the overlapping region exceeds 80% of the height of the shorter bounding box."""
    _, y0_1, _, y1_1 = bbox1
    _, y0_2, _, y1_2 = bbox2

    overlap = max(0, min(y1_1, y1_2) - max(y0_1, y0_2))
    height1, height2 = y1_1 - y0_1, y1_2 - y0_2
    max_height = max(height1, height2)
    min_height = min(height1, height2)

    return (overlap / min_height) > overlap_ratio_threshold


def bbox_to_points(bbox):
    """ change bbox(shape: N * 4) to polygon(shape: N * 8) """
    x0, y0, x1, y1 = bbox
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]).astype('float32')


def points_to_bbox(points):
    """ change polygon(shape: N * 8) to bbox(shape: N * 4) """
    x0, y0 = points[0]
    x1, _ = points[1]
    _, y1 = points[2]
    return [x0, y0, x1, y1]


def merge_intervals(intervals):
    # Sort the intervals based on the start value
    intervals.sort(key=lambda x: x[0])

    merged = []
    for interval in intervals:
        # If the list of merged intervals is empty or if the current
        # interval does not overlap with the previous, simply append it.
        if not merged or merged[-1][1] < interval[0]:
            merged.append(interval)
        else:
            # Otherwise, there is overlap, so we merge the current and previous intervals.
            merged[-1][1] = max(merged[-1][1], interval[1])

    return merged


def remove_intervals(original, masks):
    # Merge all mask intervals
    merged_masks = merge_intervals(masks)

    result = []
    original_start, original_end = original

    for mask in merged_masks:
        mask_start, mask_end = mask

        # If the mask starts after the original range, ignore it
        if mask_start > original_end:
            continue

        # If the mask ends before the original range starts, ignore it
        if mask_end < original_start:
            continue

        # Remove the masked part from the original range
        if original_start < mask_start:
            result.append([original_start, mask_start - 1])

        original_start = max(mask_end + 1, original_start)

    # Add the remaining part of the original range, if any
    if original_start <= original_end:
        result.append([original_start, original_end])

    return result


def update_det_boxes(dt_boxes, mfd_res):
    new_dt_boxes = []
    for text_box in dt_boxes:
        text_bbox = points_to_bbox(text_box)
        masks_list = []
        for mf_box in mfd_res:
            mf_bbox = mf_box['bbox']
            if __is_overlaps_y_exceeds_threshold(text_bbox, mf_bbox):
                masks_list.append([mf_bbox[0], mf_bbox[2]])
        text_x_range = [text_bbox[0], text_bbox[2]]
        text_remove_mask_range = remove_intervals(text_x_range, masks_list)
        temp_dt_box = []
        for text_remove_mask in text_remove_mask_range:
            temp_dt_box.append(bbox_to_points([text_remove_mask[0], text_bbox[1], text_remove_mask[1], text_bbox[3]]))
        if len(temp_dt_box) > 0:
            new_dt_boxes.extend(temp_dt_box)
    return new_dt_boxes


def merge_spans_to_line(spans):
    """
    Merge given spans into lines. Spans are considered based on their position in the document.
    If spans overlap sufficiently on the Y-axis, they are merged into the same line; otherwise, a new line is started.

    Parameters:
    spans (list): A list of spans, where each span is a dictionary containing at least the key 'bbox',
                  which itself is a list of four integers representing the bounding box:
                  [x0, y0, x1, y1], where (x0, y0) is the top-left corner and (x1, y1) is the bottom-right corner.

    Returns:
    list: A list of lines, where each line is a list of spans.
    """
    # Return an empty list if the spans list is empty
    if len(spans) == 0:
        return []
    else:
        # Sort spans by the Y0 coordinate
        spans.sort(key=lambda span: span['bbox'][1])

        lines = []
        current_line = [spans[0]]
        for span in spans[1:]:
            # If the current span overlaps with the last span in the current line on the Y-axis, add it to the current line
            if __is_overlaps_y_exceeds_threshold(span['bbox'], current_line[-1]['bbox']):
                current_line.append(span)
            else:
                # Otherwise, start a new line
                lines.append(current_line)
                current_line = [span]

        # Add the last line if it exists
        if current_line:
            lines.append(current_line)

        return lines


def merge_overlapping_spans(spans):
    """
    Merges overlapping spans on the same line.

    :param spans: A list of span coordinates [(x1, y1, x2, y2), ...]
    :return: A list of merged spans
    """
    # Return an empty list if the input spans list is empty
    if not spans:
        return []

    # Sort spans by their starting x-coordinate
    spans.sort(key=lambda x: x[0])

    # Initialize the list of merged spans
    merged = []
    for span in spans:
        # Unpack span coordinates
        x1, y1, x2, y2 = span
        # If the merged list is empty or there's no horizontal overlap, add the span directly
        if not merged or merged[-1][2] < x1:
            merged.append(span)
        else:
            # If there is horizontal overlap, merge the current span with the previous one
            last_span = merged.pop()
            # Update the merged span's top-left corner to the smaller (x1, y1) and bottom-right to the larger (x2, y2)
            x1 = min(last_span[0], x1)
            y1 = min(last_span[1], y1)
            x2 = max(last_span[2], x2)
            y2 = max(last_span[3], y2)
            # Add the merged span back to the list
            merged.append((x1, y1, x2, y2))

    # Return the list of merged spans
    return merged


def merge_det_boxes(dt_boxes):
    """
    Merge detection boxes.

    This function takes a list of detected bounding boxes, each represented by four corner points.
    The goal is to merge these bounding boxes into larger text regions.

    Parameters:
    dt_boxes (list): A list containing multiple text detection boxes, where each box is defined by four corner points.

    Returns:
    list: A list containing the merged text regions, where each region is represented by four corner points.
    """
    # Convert the detection boxes into a dictionary format with bounding boxes and type
    dt_boxes_dict_list = []
    for text_box in dt_boxes:
        text_bbox = points_to_bbox(text_box)
        text_box_dict = {
            'bbox': text_bbox,
        }
        dt_boxes_dict_list.append(text_box_dict)

    # Merge adjacent text regions into lines
    lines = merge_spans_to_line(dt_boxes_dict_list)

    # Initialize a new list for storing the merged text regions
    new_dt_boxes = []
    for line in lines:
        line_bbox_list = []
        for span in line:
            line_bbox_list.append(span['bbox'])

        # Merge overlapping text regions within the same line
        merged_spans = merge_overlapping_spans(line_bbox_list)

        # Convert the merged text regions back to point format and add them to the new detection box list
        for span in merged_spans:
            new_dt_boxes.append(bbox_to_points(span))

    return new_dt_boxes

@MODEL_REGISTRY.register('ocr_ppocr')
class ModifiedPaddleOCR(PaddleOCR):
    def __init__(self, config):
        super().__init__(**config)
        
    def predict(self, img, **kwargs):
        ppocr_res = self.ocr(img, **kwargs)[0]
        ocr_res = []
        for box_ocr_res in ppocr_res:
            p1, p2, p3, p4 = box_ocr_res[0]
            text, score = box_ocr_res[1]
            ocr_res.append({
                "category_type": "text",
                'poly': p1 + p2 + p3 + p4,
                'score': round(score, 2),
                'text': text,
            })
        return ocr_res
        
    def ocr(self, img, det=True, rec=True, cls=True, bin=False, inv=False, mfd_res=None, alpha_color=(255, 255, 255)):
        """
        OCR with PaddleOCR
        args：
            img: img for OCR, support ndarray, img_path and list or ndarray
            det: use text detection or not. If False, only rec will be exec. Default is True
            rec: use text recognition or not. If False, only det will be exec. Default is True
            cls: use angle classifier or not. Default is True. If True, the text with rotation of 180 degrees can be recognized. If no text is rotated by 180 degrees, use cls=False to get better performance. Text with rotation of 90 or 270 degrees can be recognized even if cls=False.
            bin: binarize image to black and white. Default is False.
            inv: invert image colors. Default is False.
            alpha_color: set RGB color Tuple for transparent parts replacement. Default is pure white.
        """
        assert isinstance(img, (np.ndarray, list, str, bytes, Image.Image))
        if isinstance(img, list) and det == True:
            logger.error('When input a list of images, det must be false')
            exit(0)
        if cls == True and self.use_angle_cls == False:
            logger.warning(
                'Since the angle classifier is not initialized, it will not be used during the forward process'
            )

        img = check_img(img)
        # for infer pdf file
        if isinstance(img, list):
            if self.page_num > len(img) or self.page_num == 0:
                self.page_num = len(img)
            imgs = img[:self.page_num]
        else:
            imgs = [img]

        def preprocess_image(_image):
            _image = alpha_to_color(_image, alpha_color)
            if inv:
                _image = cv2.bitwise_not(_image)
            if bin:
                _image = binarize_img(_image)
            return _image

        if det and rec:
            ocr_res = []
            for idx, img in enumerate(imgs):
                img = preprocess_image(img)
                dt_boxes, rec_res, _ = self.__call__(img, cls, mfd_res=mfd_res)
                if not dt_boxes and not rec_res:
                    ocr_res.append(None)
                    continue
                tmp_res = [[box.tolist(), res]
                           for box, res in zip(dt_boxes, rec_res)]
                ocr_res.append(tmp_res)
            return ocr_res
        elif det and not rec:
            ocr_res = []
            for idx, img in enumerate(imgs):
                img = preprocess_image(img)
                dt_boxes, elapse = self.text_detector(img)
                if not dt_boxes:
                    ocr_res.append(None)
                    continue
                tmp_res = [box.tolist() for box in dt_boxes]
                ocr_res.append(tmp_res)
            return ocr_res
        else:
            ocr_res = []
            cls_res = []
            for idx, img in enumerate(imgs):
                if not isinstance(img, list):
                    img = preprocess_image(img)
                    img = [img]
                if self.use_angle_cls and cls:
                    img, cls_res_tmp, elapse = self.text_classifier(img)
                    if not rec:
                        cls_res.append(cls_res_tmp)
                rec_res, elapse = self.text_recognizer(img)
                ocr_res.append(rec_res)
            if not rec:
                return cls_res
            return ocr_res
        
    def __call__(self, img, cls=True, mfd_res=None):
        time_dict = {'det': 0, 'rec': 0, 'cls': 0, 'all': 0}

        if img is None:
            logger.debug("no valid image provided")
            return None, None, time_dict

        start = time.time()
        ori_im = img.copy()
        dt_boxes, elapse = self.text_detector(img)
        time_dict['det'] = elapse

        if dt_boxes is None:
            logger.debug("no dt_boxes found, elapsed : {}".format(elapse))
            end = time.time()
            time_dict['all'] = end - start
            return None, None, time_dict
        else:
            logger.debug("dt_boxes num : {}, elapsed : {}".format(
                len(dt_boxes), elapse))
        img_crop_list = []

        dt_boxes = sorted_boxes(dt_boxes)

        dt_boxes = merge_det_boxes(dt_boxes)

        if mfd_res:
            bef = time.time()
            dt_boxes = update_det_boxes(dt_boxes, mfd_res)
            aft = time.time()
            logger.debug("split text box by formula, new dt_boxes num : {}, elapsed : {}".format(
                len(dt_boxes), aft-bef))

        for bno in range(len(dt_boxes)):
            tmp_box = copy.deepcopy(dt_boxes[bno])
            if self.args.det_box_type == "quad":
                img_crop = get_rotate_crop_image(ori_im, tmp_box)
            else:
                img_crop = get_minarea_rect_crop(ori_im, tmp_box)
            img_crop_list.append(img_crop)
        if self.use_angle_cls and cls:
            img_crop_list, angle_list, elapse = self.text_classifier(
                img_crop_list)
            time_dict['cls'] = elapse
            logger.debug("cls num  : {}, elapsed : {}".format(
                len(img_crop_list), elapse))

        rec_res, elapse = self.text_recognizer(img_crop_list)
        time_dict['rec'] = elapse
        logger.debug("rec_res num  : {}, elapsed : {}".format(
            len(rec_res), elapse))
        if self.args.save_crop_res:
            self.draw_crop_rec_res(self.args.crop_res_save_dir, img_crop_list,
                                   rec_res)
        filter_boxes, filter_rec_res = [], []
        for box, rec_result in zip(dt_boxes, rec_res):
            text, score = rec_result
            if score >= self.drop_score:
                filter_boxes.append(box)
                filter_rec_res.append(rec_result)
        end = time.time()
        time_dict['all'] = end - start
        return filter_boxes, filter_rec_res, time_dict