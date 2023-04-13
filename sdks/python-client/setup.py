from setuptools import setup

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="langgenius-client",
    version="0.1.3",
    author="LangGenius",
    author_email="hello@langgenius.ai",
    description="A package for interacting with the LangGenius Service-API",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/langgenius/langgenius-client",
    license='MIT',
    packages=['langgenius'],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.6",
    install_requires=[
        "requests"
    ],
    keywords='langgenius nlp ai language-processing',
    include_package_data=True,
)
