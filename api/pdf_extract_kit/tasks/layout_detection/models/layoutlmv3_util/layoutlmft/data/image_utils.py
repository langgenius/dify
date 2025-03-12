import torchvision.transforms.functional as F
import warnings
import math
import random
import numpy as np
from PIL import Image
import torch

from detectron2.data.detection_utils import read_image
from detectron2.data.transforms import ResizeTransform, TransformList

def normalize_bbox(bbox, size):
    return [
        int(1000 * bbox[0] / size[0]),
        int(1000 * bbox[1] / size[1]),
        int(1000 * bbox[2] / size[0]),
        int(1000 * bbox[3] / size[1]),
    ]


def load_image(image_path):
    image = read_image(image_path, format="BGR")
    h = image.shape[0]
    w = image.shape[1]
    img_trans = TransformList([ResizeTransform(h=h, w=w, new_h=224, new_w=224)])
    image = torch.tensor(img_trans.apply_image(image).copy()).permute(2, 0, 1)  # copy to make it writeable
    return image, (w, h)


def crop(image, i, j, h, w, boxes=None):
    cropped_image = F.crop(image, i, j, h, w)

    if boxes is not None:
        # Currently we cannot use this case since when some boxes is out of the cropped image,
        # it may be better to drop out these boxes along with their text input (instead of min or clamp)
        # which haven't been implemented here
        max_size = torch.as_tensor([w, h], dtype=torch.float32)
        cropped_boxes = torch.as_tensor(boxes) - torch.as_tensor([j, i, j, i])
        cropped_boxes = torch.min(cropped_boxes.reshape(-1, 2, 2), max_size)
        cropped_boxes = cropped_boxes.clamp(min=0)
        boxes = cropped_boxes.reshape(-1, 4)

    return cropped_image, boxes


def resize(image, size, interpolation, boxes=None):
    # It seems that we do not need to resize boxes here, since the boxes will be resized to 1000x1000 finally,
    # which is compatible with a square image size of 224x224
    rescaled_image = F.resize(image, size, interpolation)

    if boxes is None:
        return rescaled_image, None

    ratios = tuple(float(s) / float(s_orig) for s, s_orig in zip(rescaled_image.size, image.size))
    ratio_width, ratio_height = ratios

    # boxes = boxes.copy()
    scaled_boxes = boxes * torch.as_tensor([ratio_width, ratio_height, ratio_width, ratio_height])

    return rescaled_image, scaled_boxes


def clamp(num, min_value, max_value):
    return max(min(num, max_value), min_value)


def get_bb(bb, page_size):
    bbs = [float(j) for j in bb]
    xs, ys = [], []
    for i, b in enumerate(bbs):
        if i % 2 == 0:
            xs.append(b)
        else:
            ys.append(b)
    (width, height) = page_size
    return_bb = [
        clamp(min(xs), 0, width - 1),
        clamp(min(ys), 0, height - 1),
        clamp(max(xs), 0, width - 1),
        clamp(max(ys), 0, height - 1),
    ]
    return_bb = [
            int(1000 * return_bb[0] / width),
            int(1000 * return_bb[1] / height),
            int(1000 * return_bb[2] / width),
            int(1000 * return_bb[3] / height),
        ]
    return return_bb


class ToNumpy:

    def __call__(self, pil_img):
        np_img = np.array(pil_img, dtype=np.uint8)
        if np_img.ndim < 3:
            np_img = np.expand_dims(np_img, axis=-1)
        np_img = np.rollaxis(np_img, 2)  # HWC to CHW
        return np_img


class ToTensor:

    def __init__(self, dtype=torch.float32):
        self.dtype = dtype

    def __call__(self, pil_img):
        np_img = np.array(pil_img, dtype=np.uint8)
        if np_img.ndim < 3:
            np_img = np.expand_dims(np_img, axis=-1)
        np_img = np.rollaxis(np_img, 2)  # HWC to CHW
        return torch.from_numpy(np_img).to(dtype=self.dtype)


_pil_interpolation_to_str = {
    F.InterpolationMode.NEAREST: 'F.InterpolationMode.NEAREST',
    F.InterpolationMode.BILINEAR: 'F.InterpolationMode.BILINEAR',
    F.InterpolationMode.BICUBIC: 'F.InterpolationMode.BICUBIC',
    F.InterpolationMode.LANCZOS: 'F.InterpolationMode.LANCZOS',
    F.InterpolationMode.HAMMING: 'F.InterpolationMode.HAMMING',
    F.InterpolationMode.BOX: 'F.InterpolationMode.BOX',
}


def _pil_interp(method):
    if method == 'bicubic':
        return F.InterpolationMode.BICUBIC
    elif method == 'lanczos':
        return F.InterpolationMode.LANCZOS
    elif method == 'hamming':
        return F.InterpolationMode.HAMMING
    else:
        # default bilinear, do we want to allow nearest?
        return F.InterpolationMode.BILINEAR


class Compose:
    """Composes several transforms together. This transform does not support torchscript.
    Please, see the note below.

    Args:
        transforms (list of ``Transform`` objects): list of transforms to compose.

    Example:
        >>> transforms.Compose([
        >>>     transforms.CenterCrop(10),
        >>>     transforms.PILToTensor(),
        >>>     transforms.ConvertImageDtype(torch.float),
        >>> ])

    .. note::
        In order to script the transformations, please use ``torch.nn.Sequential`` as below.

        >>> transforms = torch.nn.Sequential(
        >>>     transforms.CenterCrop(10),
        >>>     transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        >>> )
        >>> scripted_transforms = torch.jit.script(transforms)

        Make sure to use only scriptable transformations, i.e. that work with ``torch.Tensor``, does not require
        `lambda` functions or ``PIL.Image``.

    """

    def __init__(self, transforms):
        self.transforms = transforms

    def __call__(self, img, augmentation=False, box=None):
        for t in self.transforms:
            img = t(img, augmentation, box)
        return img


class RandomResizedCropAndInterpolationWithTwoPic:
    """Crop the given PIL Image to random size and aspect ratio with random interpolation.
    A crop of random size (default: of 0.08 to 1.0) of the original size and a random
    aspect ratio (default: of 3/4 to 4/3) of the original aspect ratio is made. This crop
    is finally resized to given size.
    This is popularly used to train the Inception networks.
    Args:
        size: expected output size of each edge
        scale: range of size of the origin size cropped
        ratio: range of aspect ratio of the origin aspect ratio cropped
        interpolation: Default: PIL.Image.BILINEAR
    """

    def __init__(self, size, second_size=None, scale=(0.08, 1.0), ratio=(3. / 4., 4. / 3.),
                 interpolation='bilinear', second_interpolation='lanczos'):
        if isinstance(size, tuple):
            self.size = size
        else:
            self.size = (size, size)
        if second_size is not None:
            if isinstance(second_size, tuple):
                self.second_size = second_size
            else:
                self.second_size = (second_size, second_size)
        else:
            self.second_size = None
        if (scale[0] > scale[1]) or (ratio[0] > ratio[1]):
            warnings.warn("range should be of kind (min, max)")

        self.interpolation = _pil_interp(interpolation)
        self.second_interpolation = _pil_interp(second_interpolation)
        self.scale = scale
        self.ratio = ratio

    @staticmethod
    def get_params(img, scale, ratio):
        """Get parameters for ``crop`` for a random sized crop.
        Args:
            img (PIL Image): Image to be cropped.
            scale (tuple): range of size of the origin size cropped
            ratio (tuple): range of aspect ratio of the origin aspect ratio cropped
        Returns:
            tuple: params (i, j, h, w) to be passed to ``crop`` for a random
                sized crop.
        """
        area = img.size[0] * img.size[1]

        for attempt in range(10):
            target_area = random.uniform(*scale) * area
            log_ratio = (math.log(ratio[0]), math.log(ratio[1]))
            aspect_ratio = math.exp(random.uniform(*log_ratio))

            w = int(round(math.sqrt(target_area * aspect_ratio)))
            h = int(round(math.sqrt(target_area / aspect_ratio)))

            if w <= img.size[0] and h <= img.size[1]:
                i = random.randint(0, img.size[1] - h)
                j = random.randint(0, img.size[0] - w)
                return i, j, h, w

        # Fallback to central crop
        in_ratio = img.size[0] / img.size[1]
        if in_ratio < min(ratio):
            w = img.size[0]
            h = int(round(w / min(ratio)))
        elif in_ratio > max(ratio):
            h = img.size[1]
            w = int(round(h * max(ratio)))
        else:  # whole image
            w = img.size[0]
            h = img.size[1]
        i = (img.size[1] - h) // 2
        j = (img.size[0] - w) // 2
        return i, j, h, w

    def __call__(self, img, augmentation=False, box=None):
        """
        Args:
            img (PIL Image): Image to be cropped and resized.
        Returns:
            PIL Image: Randomly cropped and resized image.
        """
        if augmentation:
            i, j, h, w = self.get_params(img, self.scale, self.ratio)
            img = F.crop(img, i, j, h, w)
            # img, box = crop(img, i, j, h, w, box)
        img = F.resize(img, self.size, self.interpolation)
        second_img = F.resize(img, self.second_size, self.second_interpolation) \
            if self.second_size is not None else None
        return img, second_img

    def __repr__(self):
        if isinstance(self.interpolation, (tuple, list)):
            interpolate_str = ' '.join([_pil_interpolation_to_str[x] for x in self.interpolation])
        else:
            interpolate_str = _pil_interpolation_to_str[self.interpolation]
        format_string = self.__class__.__name__ + '(size={0}'.format(self.size)
        format_string += ', scale={0}'.format(tuple(round(s, 4) for s in self.scale))
        format_string += ', ratio={0}'.format(tuple(round(r, 4) for r in self.ratio))
        format_string += ', interpolation={0}'.format(interpolate_str)
        if self.second_size is not None:
            format_string += ', second_size={0}'.format(self.second_size)
            format_string += ', second_interpolation={0}'.format(_pil_interpolation_to_str[self.second_interpolation])
        format_string += ')'
        return format_string


def pil_loader(path: str) -> Image.Image:
    # open path as file to avoid ResourceWarning (https://github.com/python-pillow/Pillow/issues/835)
    with open(path, 'rb') as f:
        img = Image.open(f)
        return img.convert('RGB')
