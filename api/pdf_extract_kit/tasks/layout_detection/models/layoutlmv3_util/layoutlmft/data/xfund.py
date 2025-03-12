import os
import json

import torch
from torch.utils.data.dataset import Dataset
from torchvision import transforms
from PIL import Image

from .image_utils import Compose, RandomResizedCropAndInterpolationWithTwoPic

XFund_label2ids = {
    "O":0,
    'B-HEADER':1,
    'I-HEADER':2,
    'B-QUESTION':3,
    'I-QUESTION':4,
    'B-ANSWER':5,
    'I-ANSWER':6,
}

class xfund_dataset(Dataset):
    def box_norm(self, box, width, height):
        def clip(min_num, num, max_num):
            return min(max(num, min_num), max_num)

        x0, y0, x1, y1 = box
        x0 = clip(0, int((x0 / width) * 1000), 1000)
        y0 = clip(0, int((y0 / height) * 1000), 1000)
        x1 = clip(0, int((x1 / width) * 1000), 1000)
        y1 = clip(0, int((y1 / height) * 1000), 1000)
        assert x1 >= x0
        assert y1 >= y0
        return [x0, y0, x1, y1]

    def get_segment_ids(self, bboxs):
        segment_ids = []
        for i in range(len(bboxs)):
            if i == 0:
                segment_ids.append(0)
            else:
                if bboxs[i - 1] == bboxs[i]:
                    segment_ids.append(segment_ids[-1])
                else:
                    segment_ids.append(segment_ids[-1] + 1)
        return segment_ids

    def get_position_ids(self, segment_ids):
        position_ids = []
        for i in range(len(segment_ids)):
            if i == 0:
                position_ids.append(2)
            else:
                if segment_ids[i] == segment_ids[i - 1]:
                    position_ids.append(position_ids[-1] + 1)
                else:
                    position_ids.append(2)
        return position_ids

    def load_data(
            self,
            data_file,
    ):
        # re-org data format
        total_data = {"id": [], "lines": [], "bboxes": [], "ner_tags": [], "image_path": []}
        for i in range(len(data_file['documents'])):
            width, height = data_file['documents'][i]['img']['width'], data_file['documents'][i]['img'][
                'height']

            cur_doc_lines, cur_doc_bboxes, cur_doc_ner_tags, cur_doc_image_path = [], [], [], []
            for j in range(len(data_file['documents'][i]['document'])):
                cur_item = data_file['documents'][i]['document'][j]
                cur_doc_lines.append(cur_item['text'])
                cur_doc_bboxes.append(self.box_norm(cur_item['box'], width=width, height=height))
                cur_doc_ner_tags.append(cur_item['label'])
            total_data['id'] += [len(total_data['id'])]
            total_data['lines'] += [cur_doc_lines]
            total_data['bboxes'] += [cur_doc_bboxes]
            total_data['ner_tags'] += [cur_doc_ner_tags]
            total_data['image_path'] += [data_file['documents'][i]['img']['fname']]

        # tokenize text and get bbox/label
        total_input_ids, total_bboxs, total_label_ids = [], [], []
        for i in range(len(total_data['lines'])):
            cur_doc_input_ids, cur_doc_bboxs, cur_doc_labels = [], [], []
            for j in range(len(total_data['lines'][i])):
                cur_input_ids = self.tokenizer(total_data['lines'][i][j], truncation=False, add_special_tokens=False, return_attention_mask=False)['input_ids']
                if len(cur_input_ids) == 0: continue

                cur_label = total_data['ner_tags'][i][j].upper()
                if cur_label == 'OTHER':
                    cur_labels = ["O"] * len(cur_input_ids)
                    for k in range(len(cur_labels)):
                        cur_labels[k] = self.label2ids[cur_labels[k]]
                else:
                    cur_labels = [cur_label] * len(cur_input_ids)
                    cur_labels[0] = self.label2ids['B-' + cur_labels[0]]
                    for k in range(1, len(cur_labels)):
                        cur_labels[k] = self.label2ids['I-' + cur_labels[k]]
                assert len(cur_input_ids) == len([total_data['bboxes'][i][j]] * len(cur_input_ids)) == len(cur_labels)
                cur_doc_input_ids += cur_input_ids
                cur_doc_bboxs += [total_data['bboxes'][i][j]] * len(cur_input_ids)
                cur_doc_labels += cur_labels
            assert len(cur_doc_input_ids) == len(cur_doc_bboxs) == len(cur_doc_labels)
            assert len(cur_doc_input_ids) > 0

            total_input_ids.append(cur_doc_input_ids)
            total_bboxs.append(cur_doc_bboxs)
            total_label_ids.append(cur_doc_labels)
        assert len(total_input_ids) == len(total_bboxs) == len(total_label_ids)

        # split text to several slices because of over-length
        input_ids, bboxs, labels = [], [], []
        segment_ids, position_ids = [], []
        image_path = []
        for i in range(len(total_input_ids)):
            start = 0
            cur_iter = 0
            while start < len(total_input_ids[i]):
                end = min(start + 510, len(total_input_ids[i]))

                input_ids.append([self.tokenizer.cls_token_id] + total_input_ids[i][start: end] + [self.tokenizer.sep_token_id])
                bboxs.append([[0, 0, 0, 0]] + total_bboxs[i][start: end] + [[1000, 1000, 1000, 1000]])
                labels.append([-100] + total_label_ids[i][start: end] + [-100])

                cur_segment_ids = self.get_segment_ids(bboxs[-1])
                cur_position_ids = self.get_position_ids(cur_segment_ids)
                segment_ids.append(cur_segment_ids)
                position_ids.append(cur_position_ids)
                image_path.append(os.path.join(self.args.data_dir, "images", total_data['image_path'][i]))

                start = end
                cur_iter += 1

        assert len(input_ids) == len(bboxs) == len(labels) == len(segment_ids) == len(position_ids)
        assert len(segment_ids) == len(image_path)

        res = {
            'input_ids': input_ids,
            'bbox': bboxs,
            'labels': labels,
            'segment_ids': segment_ids,
            'position_ids': position_ids,
            'image_path': image_path,
        }
        return res

    def __init__(
            self,
            args,
            tokenizer,
            mode
    ):
        self.args = args
        self.mode = mode
        self.cur_la = args.language
        self.tokenizer = tokenizer
        self.label2ids = XFund_label2ids


        self.common_transform = Compose([
            RandomResizedCropAndInterpolationWithTwoPic(
                size=args.input_size, interpolation=args.train_interpolation,
            ),
        ])

        self.patch_transform = transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize(
                mean=torch.tensor((0.5, 0.5, 0.5)),
                std=torch.tensor((0.5, 0.5, 0.5)))
        ])

        data_file = json.load(
            open(os.path.join(args.data_dir, "{}.{}.json".format(self.cur_la, 'train' if mode == 'train' else 'val')),
                 'r'))

        self.feature = self.load_data(data_file)

    def __len__(self):
        return len(self.feature['input_ids'])

    def __getitem__(self, index):
        input_ids = self.feature["input_ids"][index]

        # attention_mask = self.feature["attention_mask"][index]
        attention_mask = [1] * len(input_ids)
        labels = self.feature["labels"][index]
        bbox = self.feature["bbox"][index]
        segment_ids = self.feature['segment_ids'][index]
        position_ids = self.feature['position_ids'][index]

        img = pil_loader(self.feature['image_path'][index])
        for_patches, _ = self.common_transform(img, augmentation=False)
        patch = self.patch_transform(for_patches)

        assert len(input_ids) == len(attention_mask) == len(labels) == len(bbox) == len(segment_ids)

        res = {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "labels": labels,
            "bbox": bbox,
            "segment_ids": segment_ids,
            "position_ids": position_ids,
            "images": patch,
        }
        return res

def pil_loader(path: str) -> Image.Image:
    # open path as file to avoid ResourceWarning (https://github.com/python-pillow/Pillow/issues/835)
    with open(path, 'rb') as f:
        img = Image.open(f)
        return img.convert('RGB')