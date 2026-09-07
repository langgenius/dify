FROM downloads.unstructured.io/unstructured-io/unstructured-api@sha256:0df934a22e4e893cf15e7aeaf35c463ecc75937758a83099aefdc13041619a1d

# The image is deliberately opt-in until its real-format golden contract passes. Reuse
# the provider's installed libraries/models; never pip-install an unpinned runtime here.
USER 1000:1000
RUN python3 -c 'from importlib.metadata import version; assert version("unstructured") == "0.22.18"; import uvicorn, psutil, oxmsg; from prepline_general.api.app import app'
COPY --chown=1000:1000 kfs_sandbox /opt/kfs-sandbox/kfs_sandbox
COPY --chown=1000:1000 golden.py /opt/kfs-sandbox/golden.py
COPY --chown=1000:1000 fixtures /opt/kfs-sandbox/fixtures
USER root
COPY bin /opt/kfs-sandbox/bin
COPY build-converter-manifest.py /opt/kfs-sandbox/build-converter-manifest.py
RUN python3 /opt/kfs-sandbox/build-converter-manifest.py && chmod 0555 /opt/kfs-sandbox/bin/soffice /opt/kfs-sandbox/bin/pandoc
ENV PYTHONPATH=/opt/kfs-sandbox:/home/notebook-user
ENV PYTHONDONTWRITEBYTECODE=1
ENV UNSTRUCTURED_PARALLEL_MODE_ENABLED=false
ENV PATH=/opt/kfs-sandbox/bin:${PATH}
ENV PYPANDOC_PANDOC=/opt/kfs-sandbox/bin/pandoc
USER 1000:1000
ENTRYPOINT ["python3", "-m", "kfs_sandbox"]
