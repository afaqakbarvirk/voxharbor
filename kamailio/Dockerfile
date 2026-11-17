FROM alpine:3.22

ARG KAM_VERSION=6.0.6-r0

RUN apk add --no-cache \
      kamailio=${KAM_VERSION} \
      kamailio-db=${KAM_VERSION} \
      kamailio-mysql=${KAM_VERSION} \
      kamailio-websocket=${KAM_VERSION} \
      kamailio-extras=${KAM_VERSION} \
      kamailio-utils=${KAM_VERSION} \
 && mkdir -p /run/kamailio

HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD kamcmd core.uptime >/dev/null || exit 1

CMD ["kamailio", "-DD", "-E", "-m", "128", "-M", "16", "-f", "/etc/kamailio/kamailio.cfg"]
