from .visualizer import Visualizer
from .rcnn_vl import *
from .backbone import *

from detectron2.config import get_cfg
from detectron2.config import CfgNode as CN
from detectron2.data import MetadataCatalog, DatasetCatalog
from detectron2.data.datasets import register_coco_instances
from detectron2.engine import DefaultTrainer, default_argument_parser, default_setup, launch, DefaultPredictor

def add_vit_config(cfg):
    """
    Add config for VIT.
    """
    _C = cfg

    _C.MODEL.VIT = CN()

    # CoaT model name.
    _C.MODEL.VIT.NAME = ""

    # Output features from CoaT backbone.
    _C.MODEL.VIT.OUT_FEATURES = ["layer3", "layer5", "layer7", "layer11"]

    _C.MODEL.VIT.IMG_SIZE = [224, 224]

    _C.MODEL.VIT.POS_TYPE = "shared_rel"

    _C.MODEL.VIT.DROP_PATH = 0.

    _C.MODEL.VIT.MODEL_KWARGS = "{}"

    _C.SOLVER.OPTIMIZER = "ADAMW"

    _C.SOLVER.BACKBONE_MULTIPLIER = 1.0

    _C.AUG = CN()

    _C.AUG.DETR = False

    _C.MODEL.IMAGE_ONLY = True
    _C.PUBLAYNET_DATA_DIR_TRAIN = ""
    _C.PUBLAYNET_DATA_DIR_TEST = ""
    _C.FOOTNOTE_DATA_DIR_TRAIN = ""
    _C.FOOTNOTE_DATA_DIR_VAL = ""
    _C.SCIHUB_DATA_DIR_TRAIN = ""
    _C.SCIHUB_DATA_DIR_TEST = ""
    _C.JIAOCAI_DATA_DIR_TRAIN = ""
    _C.JIAOCAI_DATA_DIR_TEST = ""
    _C.ICDAR_DATA_DIR_TRAIN = ""
    _C.ICDAR_DATA_DIR_TEST = ""
    _C.M6DOC_DATA_DIR_TEST = ""
    _C.DOCSTRUCTBENCH_DATA_DIR_TEST = ""
    _C.DOCSTRUCTBENCHv2_DATA_DIR_TEST = ""
    _C.CACHE_DIR = ""
    _C.MODEL.CONFIG_PATH = ""

    # effective update steps would be MAX_ITER/GRADIENT_ACCUMULATION_STEPS
    # maybe need to set MAX_ITER *= GRADIENT_ACCUMULATION_STEPS
    _C.SOLVER.GRADIENT_ACCUMULATION_STEPS = 1


def setup(args):
    """
    Create configs and perform basic setups.
    """
    cfg = get_cfg()
    # add_coat_config(cfg)
    add_vit_config(cfg)
    cfg.merge_from_file(args.config_file)
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.2  # set threshold for this model
    cfg.merge_from_list(args.opts)
    cfg.freeze()
    default_setup(cfg, args)
    
    register_coco_instances(
        "scihub_train",
        {},
        cfg.SCIHUB_DATA_DIR_TRAIN + ".json",
        cfg.SCIHUB_DATA_DIR_TRAIN
    )
    
    return cfg


class DotDict(dict):
    def __init__(self, *args, **kwargs):
        super(DotDict, self).__init__(*args, **kwargs)

    def __getattr__(self, key):
        if key not in self.keys():
            return None
        value = self[key]
        if isinstance(value, dict):
            value = DotDict(value)
        return value
    
    def __setattr__(self, key, value):
        self[key] = value
        
class Layoutlmv3_Predictor(object):
    def __init__(self, weights):
        layout_args = {
            "config_file": "pdf_extract_kit/tasks/layout_detection/models/layoutlmv3_util/layoutlmv3_base_inference.yaml",
            "resume": False,
            "eval_only": False,
            "num_gpus": 1,
            "num_machines": 1,
            "machine_rank": 0,
            "dist_url": "tcp://127.0.0.1:57823",
            "opts": ["MODEL.WEIGHTS", weights],
        }
        layout_args = DotDict(layout_args)

        cfg = setup(layout_args)
        self.mapping = ["title", "plain text", "abandon", "figure", "figure_caption", "table", "table_caption", "table_footnote", "isolate_formula", "formula_caption"]
        MetadataCatalog.get(cfg.DATASETS.TRAIN[0]).thing_classes = self.mapping
        self.predictor = DefaultPredictor(cfg)
        
    def __call__(self, image, ignore_catids=[]):
        page_layout_result = {
            "layout_dets": []
        }
        outputs = self.predictor(image)
        boxes = outputs["instances"].to("cpu")._fields["pred_boxes"].tensor.tolist()
        labels = outputs["instances"].to("cpu")._fields["pred_classes"].tolist()
        scores = outputs["instances"].to("cpu")._fields["scores"].tolist()
        for bbox_idx in range(len(boxes)):
            if labels[bbox_idx] in ignore_catids:
                continue
            page_layout_result["layout_dets"].append({
                "category_id": labels[bbox_idx],
                "poly": [
                    boxes[bbox_idx][0], boxes[bbox_idx][1],
                    boxes[bbox_idx][2], boxes[bbox_idx][1],
                    boxes[bbox_idx][2], boxes[bbox_idx][3],
                    boxes[bbox_idx][0], boxes[bbox_idx][3],
                ],
                "score": scores[bbox_idx]
            })
        return page_layout_result