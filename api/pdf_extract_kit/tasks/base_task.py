import os
from pdf_extract_kit.utils.data_preprocess import load_pdf


class BaseTask:
    def __init__(self, model):
        self.model = model

    def load_images(self, input_data):
        """
        Loads images from a single image path or a directory containing multiple images.

        Args:
            input_data (str): Path to a single image file or a directory containing image files.

        Returns:
            list: List of paths to all images to be predicted.
        """
        images = []

        if os.path.isdir(input_data):
            # If input_data is a directory, check for nested directories
            for root, dirs, files in os.walk(input_data):
                if dirs:
                    raise ValueError("Input directory should not contain nested directories: {}".format(input_data))
                for file in files:
                    if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                        image_path = os.path.join(root, file)
                        images.append(image_path)
                images = sorted(images)
                break  # Only process the top-level directory
        else:
            # Determine the type of input data and process accordingly
            if input_data.lower().endswith(('.png', '.jpg', '.jpeg')):
                # If input is a single image file
                images = [input_data]
            else:
                raise ValueError("Unsupported input data format: {}".format(input_data))

        return images

    def load_pdf_images(self, input_data):
        """
        Loads images from a single PDF file or directory containing multiple PDF files.

        Args:
            input_data (str): Path to a single PDF file or a directory containing PDF files.

        Returns:
            dict: Dictionary with image IDs (formed by PDF path and page number) as keys and corresponding PIL.Image objects as values.
                  Note: Loading multiple PDFs at once is not recommended due to high memory consumption. Consider processing one PDF at a time externally using loops or multithreading.
        """
        pdf_images = {}

        if os.path.isdir(input_data):
            # If input_data is a directory, check for nested directories
            for root, dirs, files in os.walk(input_data):
                if dirs:
                    raise ValueError("Input directory should not contain nested directories: {}".format(input_data))
                for file in files:
                    if file.lower().endswith(('.pdf')):
                        pdf_path = os.path.join(root, file)
                        images = load_pdf(pdf_path)
                        for i, img in enumerate(images):
                            img_id = f"{os.path.splitext(file)[0]}_page_{i+1:04d}"
                            pdf_images[img_id] = img
                # images = sorted(images)
                break  # Only process the top-level directory
        else:
            # Determine the type of input data and process accordingly
            if input_data.lower().endswith(('.pdf')):
                # If input is a single image file
                images = load_pdf(input_data)
                for i, img in enumerate(images):
                    img_id = f"{os.path.splitext(os.path.basename(input_data))[0]}_page_{i+1:04d}"
                    pdf_images[img_id] = img
            else:
                raise ValueError("Unsupported input data format: {}".format(input_data))

        return pdf_images