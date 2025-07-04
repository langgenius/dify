#!/home/zdj/value/dify/venv312/bin/python3.12
##############################################################################
#
# vba_extract - A simple utility to extract a vbaProject.bin binary from an
# Excel 2007+ xlsm file for insertion into an XlsxWriter file.
#
# SPDX-License-Identifier: BSD-2-Clause
#
# Copyright (c) 2013-2025, John McNamara, jmcnamara@cpan.org
#
import sys
from zipfile import BadZipFile, ZipFile


def extract_file(xlsm_zip, filename):
    # Extract a single file from an Excel xlsm macro file.
    data = xlsm_zip.read("xl/" + filename)
    # Write the data to a local file.
    file = open(filename, "wb")
    file.write(data)
    file.close()


# The VBA project file and project signature file we want to extract.
vba_filename = "vbaProject.bin"
vba_signature_filename = "vbaProjectSignature.bin"
# Get the xlsm file name from the commandline.
if len(sys.argv) > 1:
    xlsm_file = sys.argv[1]
else:
    print(
        "\nUtility to extract a vbaProject.bin binary from an Excel 2007+ "
        "xlsm macro file for insertion into an XlsxWriter file.\n"
        "If the macros are digitally signed, extracts also a vbaProjectSignature.bin "
        "file.\n"
        "\n"
        "See: https://xlsxwriter.readthedocs.io/working_with_macros.html\n"
        "\n"
        "Usage: vba_extract file.xlsm\n"
    )
    sys.exit()
try:
    # Open the Excel xlsm file as a zip file.
    xlsm_zip = ZipFile(xlsm_file, "r")
    # Read the xl/vbaProject.bin file.
    extract_file(xlsm_zip, vba_filename)
    print(f"Extracted: {vba_filename}")
    if "xl/" + vba_signature_filename in xlsm_zip.namelist():
        extract_file(xlsm_zip, vba_signature_filename)
        print(f"Extracted: {vba_signature_filename}")
except IOError as e:
    print(f"File error: {str(e)}")
    sys.exit()
except KeyError as e:
    # Usually when there isn't a xl/vbaProject.bin member in the file.
    print(f"File error: {str(e)}")
    print(f"File may not be an Excel xlsm macro file: '{xlsm_file}'")
    sys.exit()
except BadZipFile as e:
    # Usually if the file is an xls file and not an xlsm file.
    print(f"File error: {str(e)}: '{xlsm_file}'")
    print("File may not be an Excel xlsm macro file.")
    sys.exit()
except Exception as e:
    # Catch any other exceptions.
    print(f"File error: {str(e)}")
    sys.exit()
