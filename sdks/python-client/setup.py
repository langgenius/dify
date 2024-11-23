from setuptools import setup

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="dify-client",
    version="0.1.12",
    author="Dify",
    author_email="hello@dify.ai",
    description="A package for interacting with the Dify Service-API",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/langgenius/dify",
    license="MIT",
    packages=["dify_client"],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.6",
    install_requires=["requests"],
    keywords="dify nlp ai language-processing",
    include_package_data=True,
)
