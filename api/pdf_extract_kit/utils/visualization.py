import numpy as np
import cv2
from PIL import Image

def colormap(N=256, normalized=False):
    """
    Generate the color map.

    Args:
        N (int): Number of labels (default is 256).
        normalized (bool): If True, return colors normalized to [0, 1]. Otherwise, return [0, 255].

    Returns:
        np.ndarray: Color map array of shape (N, 3).
    """
    def bitget(byteval, idx):
        """
        Get the bit value at the specified index.

        Args:
            byteval (int): The byte value.
            idx (int): The index of the bit.

        Returns:
            int: The bit value (0 or 1).
        """
        return ((byteval & (1 << idx)) != 0)

    cmap = np.zeros((N, 3), dtype=np.uint8)
    for i in range(N):
        r = g = b = 0
        c = i
        for j in range(8):
            r = r | (bitget(c, 0) << (7 - j))
            g = g | (bitget(c, 1) << (7 - j))
            b = b | (bitget(c, 2) << (7 - j))
            c = c >> 3
        cmap[i] = np.array([r, g, b])
    
    if normalized:
        cmap = cmap.astype(np.float32) / 255.0

    return cmap

def visualize_bbox(image_path, bboxes, classes, scores, id_to_names, alpha=0.3):
    """
    Visualize layout detection results on an image.

    Args:
        image_path (str): Path to the input image.
        bboxes (list): List of bounding boxes, each represented as [x_min, y_min, x_max, y_max].
        classes (list): List of class IDs corresponding to the bounding boxes.
        id_to_names (dict): Dictionary mapping class IDs to class names.
        alpha (float): Transparency factor for the filled color (default is 0.3).

    Returns:
        np.ndarray: Image with visualized layout detection results.
    """
    # Check if image_path is a PIL.Image.Image object
    if isinstance(image_path, Image.Image):
        image = np.array(image_path)
        image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)  # Convert RGB to BGR for OpenCV
    else:
        image = cv2.imread(image_path)

    overlay = image.copy()
    
    cmap = colormap(N=len(id_to_names), normalized=False)
    
    # Iterate over each bounding box
    for i, bbox in enumerate(bboxes):
        x_min, y_min, x_max, y_max = map(int, bbox)
        class_id = int(classes[i])
        class_name = id_to_names[class_id]
        
        text = class_name + f":{scores[i]:.3f}"
        
        color = tuple(int(c) for c in cmap[class_id])
        cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), color, -1)
        cv2.rectangle(image, (x_min, y_min), (x_max, y_max), color, 2)
        
        # Add the class name with a background rectangle
        (text_width, text_height), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.9, 2)
        cv2.rectangle(image, (x_min, y_min - text_height - baseline), (x_min + text_width, y_min), color, -1)
        cv2.putText(image, text, (x_min, y_min - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    
    # Blend the overlay with the original image
    cv2.addWeighted(overlay, alpha, image, 1 - alpha, 0, image)
    
    return image