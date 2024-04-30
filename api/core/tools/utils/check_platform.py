import platform
import re
import subprocess

import PyPDF2


class PlatformUtil:
    platform_name = platform.platform()

    @staticmethod
    def isMac() -> bool:
        return re.search(r"macOS", PlatformUtil.platform_name, re.IGNORECASE) is not None


    @staticmethod
    def isLinux() -> bool:
        return re.search(r"linux", PlatformUtil.platform_name, re.IGNORECASE) is not None
            
            
    @staticmethod
    def is_gpu() -> bool:
        try:
            result = subprocess.run(['nvidia-smi'], stdout=subprocess.PIPE)
            return True if result else False
        except FileNotFoundError:
            return False
    
    
    @staticmethod
    def is_text_based_pdf(pdf_path: str) -> bool:
        try:
            with open(pdf_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                if reader.pages[0].extract_text():
                    return True
                else:
                    return False
        except Exception as e:
            print(f"error occurs when open pdf, {e}")