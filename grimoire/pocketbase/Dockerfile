# PocketBase image — fetches the official binary at build time.
# Pinned via PB_VERSION; bump intentionally, never floating.

FROM alpine:3.21 AS fetch
ARG PB_VERSION=0.38.0
RUN apk add --no-cache ca-certificates wget unzip \
 && wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip -O /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /pb \
 && chmod +x /pb/pocketbase

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget
COPY --from=fetch /pb/pocketbase /usr/local/bin/pocketbase
EXPOSE 8090
VOLUME ["/pb_data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health > /dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb_data"]
