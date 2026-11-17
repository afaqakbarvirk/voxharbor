# FreeSWITCH from Alpine's community repo: maintained, versioned, no SignalWire token needed.
FROM alpine:3.22

ARG FS_VERSION=1.10.12-r3

RUN apk add --no-cache \
      freeswitch=${FS_VERSION} \
      freeswitch-sample-config=${FS_VERSION} \
      freeswitch-sounds-en-us-callie-8000 \
      freeswitch-sounds-music-8000 \
 # Drop sample SIP profiles; we ship only our own internal.xml
 && rm -rf /etc/freeswitch/sip_profiles/* \
 # Restrict RTP ports to the range published/firewalled per node
 && sed -i \
      -e 's|<!-- <param name="rtp-start-port" value="16384"/> -->|<param name="rtp-start-port" value="$${rtp_start_port}"/>|' \
      -e 's|<!-- <param name="rtp-end-port" value="32768"/> -->|<param name="rtp-end-port" value="$${rtp_end_port}"/>|' \
      /etc/freeswitch/autoload_configs/switch.conf.xml \
 # Event socket only on loopback (fs_cli inside the container)
 && sed -i 's|<param name="listen-ip" value="::"/>|<param name="listen-ip" value="127.0.0.1"/>|' \
      /etc/freeswitch/autoload_configs/event_socket.conf.xml

HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD fs_cli -x "sofia status" | grep -q internal || exit 1

CMD ["freeswitch", "-nonat", "-c"]
