from pdf2image import convert_from_path

def load_pdf(pdf_path):
    images = convert_from_path(pdf_path)
    return images
