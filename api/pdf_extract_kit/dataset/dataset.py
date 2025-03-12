import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset
import torchvision.transforms as transforms


class ResizeLongestSide:
    def __init__(self, size):
        self.size = size

    def __call__(self, img):
        # Get the original dimensions
        width, height = img.size
        # Determine the scaling factor
        if width > height:
            new_width = self.size
            new_height = int(height * (self.size / float(width)))
        else:
            new_height = self.size
            new_width = int(width * (self.size / float(height)))
        # Resize the image
        return img.resize((new_width, new_height), Image.BILINEAR)


class ImageDataset(Dataset):
    def __init__(self, images, image_ids=None, img_size=1280):
        """
        Initialize the ImageDataset class.
        
        Args:
        - images (list): List of image paths or PIL.Image.Image objects.
        - image_ids (list, optional): List of corresponding image IDs. If None, assumes images are paths.
        - img_size (int): Size to which images' longest side will be resized.
        """
        self.images = images
        self.image_ids = image_ids if image_ids is not None else images
        self.img_size = img_size
        self.transform = transforms.Compose([
            ResizeLongestSide(self.img_size),
            transforms.ToTensor()
        ])

    def __len__(self):
        """
        Return the size of the dataset.
        
        Returns:
        int: Number of images in the dataset.
        """
        return len(self.images)

    def __getitem__(self, idx):
        """
        Get an image and its corresponding ID by index.
        
        Args:
        - idx (int): Index of the image to retrieve.
        
        Returns:
        tuple: Transformed image tensor and corresponding image ID.
        """
        image = self.images[idx]
        image_id = self.image_ids[idx]

        # Check if the image is a path or a PIL.Image object
        if isinstance(image, str):
            image = Image.open(image).convert('RGB')
        elif isinstance(image, Image.Image):
            image = image.convert('RGB')
        else:
            raise ValueError("Image must be a file path or a PIL.Image object")

        # Apply transformations
        image = self.transform(image)

        return image, image_id
    
    
class MathDataset(Dataset):
    def __init__(self, image_paths, transform=None):
        self.image_paths = image_paths
        self.transform = transform

    def __len__(self):
        return len(self.image_paths)

    def __getitem__(self, idx):
        # if not pil image, then convert to pil image
        if isinstance(self.image_paths[idx], str):
            raw_image = Image.open(self.image_paths[idx])
        else:
            raw_image = self.image_paths[idx]
        if self.transform:
            image = self.transform(raw_image)
        return image
