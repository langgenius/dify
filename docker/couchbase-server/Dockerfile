FROM couchbase/server:latest AS stage_base
# FROM couchbase:latest AS stage_base
COPY init-cbserver.sh /opt/couchbase/init/
RUN chmod +x /opt/couchbase/init/init-cbserver.sh
