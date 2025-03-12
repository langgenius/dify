# --------------------------------------------------------------------------------
# VIT: Multi-Path Vision Transformer for Dense Prediction
# Copyright (c) 2022 Electronics and Telecommunications Research Institute (ETRI).
# All Rights Reserved.
# Written by Youngwan Lee
# This source code is licensed(Dual License(GPL3.0 & Commercial)) under the license found in the
# LICENSE file in the root directory of this source tree.
# --------------------------------------------------------------------------------
# References:
# timm: https://github.com/rwightman/pytorch-image-models/tree/master/timm
# CoaT: https://github.com/mlpc-ucsd/CoaT
# --------------------------------------------------------------------------------


import torch

from detectron2.layers import (
    ShapeSpec,
)
from detectron2.modeling import Backbone, BACKBONE_REGISTRY, FPN
from detectron2.modeling.backbone.fpn import LastLevelP6P7, LastLevelMaxPool

from .beit import beit_base_patch16, dit_base_patch16, dit_large_patch16, beit_large_patch16
from .deit import deit_base_patch16, mae_base_patch16
from .layoutlmft.models.layoutlmv3 import LayoutLMv3Model
from transformers import AutoConfig

__all__ = [
    "build_vit_fpn_backbone",
]


class VIT_Backbone(Backbone):
    """
    Implement VIT backbone.
    """

    def __init__(self, name, out_features, drop_path, img_size, pos_type, model_kwargs,
                 config_path=None, image_only=False, cfg=None):
        super().__init__()
        self._out_features = out_features
        if 'base' in name:
            self._out_feature_strides = {"layer3": 4, "layer5": 8, "layer7": 16, "layer11": 32}
            self._out_feature_channels = {"layer3": 768, "layer5": 768, "layer7": 768, "layer11": 768}
        else:
            self._out_feature_strides = {"layer7": 4, "layer11": 8, "layer15": 16, "layer23": 32}
            self._out_feature_channels = {"layer7": 1024, "layer11": 1024, "layer15": 1024, "layer23": 1024}

        if name == 'beit_base_patch16':
            model_func = beit_base_patch16
        elif name == 'dit_base_patch16':
            model_func = dit_base_patch16
        elif name == "deit_base_patch16":
            model_func = deit_base_patch16
        elif name == "mae_base_patch16":
            model_func = mae_base_patch16
        elif name == "dit_large_patch16":
            model_func = dit_large_patch16
        elif name == "beit_large_patch16":
            model_func = beit_large_patch16

        if 'beit' in name or 'dit' in name:
            if pos_type == "abs":
                self.backbone = model_func(img_size=img_size,
                                           out_features=out_features,
                                           drop_path_rate=drop_path,
                                           use_abs_pos_emb=True,
                                           **model_kwargs)
            elif pos_type == "shared_rel":
                self.backbone = model_func(img_size=img_size,
                                           out_features=out_features,
                                           drop_path_rate=drop_path,
                                           use_shared_rel_pos_bias=True,
                                           **model_kwargs)
            elif pos_type == "rel":
                self.backbone = model_func(img_size=img_size,
                                           out_features=out_features,
                                           drop_path_rate=drop_path,
                                           use_rel_pos_bias=True,
                                           **model_kwargs)
            else:
                raise ValueError()
        elif "layoutlmv3" in name:
            config = AutoConfig.from_pretrained(config_path)
            # disable relative bias as DiT
            config.has_spatial_attention_bias = False
            config.has_relative_attention_bias = False
            self.backbone = LayoutLMv3Model(config, detection=True,
                                               out_features=out_features, image_only=image_only)
        else:
            self.backbone = model_func(img_size=img_size,
                                       out_features=out_features,
                                       drop_path_rate=drop_path,
                                       **model_kwargs)
        self.name = name

    def forward(self, x):
        """
        Args:
            x: Tensor of shape (N,C,H,W). H, W must be a multiple of ``self.size_divisibility``.

        Returns:
            dict[str->Tensor]: names and the corresponding features
        """
        if "layoutlmv3" in self.name:
            return self.backbone.forward(
                input_ids=x["input_ids"] if "input_ids" in x else None,
                bbox=x["bbox"] if "bbox" in x else None,
                images=x["images"] if "images" in x else None,
                attention_mask=x["attention_mask"] if "attention_mask" in x else None,
                # output_hidden_states=True,
            )
        assert x.dim() == 4, f"VIT takes an input of shape (N, C, H, W). Got {x.shape} instead!"
        return self.backbone.forward_features(x)

    def output_shape(self):
        return {
            name: ShapeSpec(
                channels=self._out_feature_channels[name], stride=self._out_feature_strides[name]
            )
            for name in self._out_features
        }


def build_VIT_backbone(cfg):
    """
    Create a VIT instance from config.

    Args:
        cfg: a detectron2 CfgNode

    Returns:
        A VIT backbone instance.
    """
    # fmt: off
    name = cfg.MODEL.VIT.NAME
    out_features = cfg.MODEL.VIT.OUT_FEATURES
    drop_path = cfg.MODEL.VIT.DROP_PATH
    img_size = cfg.MODEL.VIT.IMG_SIZE
    pos_type = cfg.MODEL.VIT.POS_TYPE

    model_kwargs = eval(str(cfg.MODEL.VIT.MODEL_KWARGS).replace("`", ""))

    if 'layoutlmv3' in name:
        if cfg.MODEL.CONFIG_PATH != '':
            config_path = cfg.MODEL.CONFIG_PATH
        else:
            config_path = cfg.MODEL.WEIGHTS.replace('pytorch_model.bin', '')  # layoutlmv3 pre-trained models
            config_path = config_path.replace('model_final.pth', '')  # detection fine-tuned models
    else:
        config_path = None

    return VIT_Backbone(name, out_features, drop_path, img_size, pos_type, model_kwargs,
                        config_path=config_path, image_only=cfg.MODEL.IMAGE_ONLY, cfg=cfg)


@BACKBONE_REGISTRY.register()
def build_vit_fpn_backbone(cfg, input_shape: ShapeSpec):
    """
    Create a VIT w/ FPN backbone.

    Args:
        cfg: a detectron2 CfgNode

    Returns:
        backbone (Backbone): backbone module, must be a subclass of :class:`Backbone`.
    """
    bottom_up = build_VIT_backbone(cfg)
    in_features = cfg.MODEL.FPN.IN_FEATURES
    out_channels = cfg.MODEL.FPN.OUT_CHANNELS
    backbone = FPN(
        bottom_up=bottom_up,
        in_features=in_features,
        out_channels=out_channels,
        norm=cfg.MODEL.FPN.NORM,
        top_block=LastLevelMaxPool(),
        fuse_type=cfg.MODEL.FPN.FUSE_TYPE,
    )
    return backbone
