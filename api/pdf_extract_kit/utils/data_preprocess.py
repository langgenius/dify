import fitz
from PIL import Image


def load_pdf_page(page, dpi):
    pix = page.get_pixmap(matrix=fitz.Matrix(dpi/72, dpi/72))
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    if pix.width > 3000 or pix.height > 3000:
        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return image

def load_pdf(pdf_path, dpi=144):
    images = []
    doc = fitz.open(pdf_path)
    for i in range(len(doc)):
        page = doc[i]
        image = load_pdf_page(page, dpi)
        images.append(image)
    return images