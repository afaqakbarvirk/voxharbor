#!/usr/bin/env bash
# VoxHarbor load test: staged SIPp call load through Kamailio -> FreeSWITCH (via rtpengine).
#
# Every call: INVITE -> 401 -> INVITE+auth -> 200 -> ACK -> hold -> BYE (5 requests per call).
# Reports per stage: success rate, call setup time (first INVITE -> 200 OK), peak CPU / memory.
#
# Usage: scripts/load-test.sh [-r "5 10 20"] [-n 200] [-d 1000] [-s 9196] [-l 25]
#   -r  call rates to test (calls/second), space separated
#   -n  calls per stage
#   -d  call hold time in ms
#   -s  number to dial (9196 echo, 9999 which-node)
#   -l  max concurrent calls (rtpengine's 101-port range carries ~25 calls)
#
# Limits worth knowing:
#   * pike bans an IP above 250 requests / 2 s, i.e. ~25 calls/s from ONE source IP.
#     Stages above 20 cps will trip the flood protection by design.
#   * SIPp sends signalling only here; real-audio relay is covered by sipp/scenarios/uac_media.xml.
set -euo pipefail
cd "$(dirname "$0")/.."

RATES="5 10 20"; CALLS=200; HOLD=1000; DIAL=9196; LIMIT=25
while getopts "r:n:d:s:l:h" opt; do
  case $opt in
    r) RATES=$OPTARG ;; n) CALLS=$OPTARG ;; d) HOLD=$OPTARG ;; s) DIAL=$OPTARG ;; l) LIMIT=$OPTARG ;;
    *) sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

PROXY=172.28.0.10:5060
PW=$(grep -E '^SIP_USER_PASSWORD=' .env | cut -d= -f2-)
WATCH="kamailio fs1 fs2 rtpengine mysql"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

docker compose up -d sipp >/dev/null 2>&1
for c in kamailio fs1 fs2 rtpengine; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || { echo "container $c is not running" >&2; exit 1; }
done

csv_field() { # $1 = csv file, $2 = column name -> value from the last row
  awk -F';' -v col="$2" 'NR==1{for(i=1;i<=NF;i++) if($i==col) c=i} END{print $c}' "$1"
}
to_ms() { # SIPp time "HH:MM:SS:usec" -> milliseconds
  awk -F: '{ printf "%.1f", ($1*3600 + $2*60 + $3)*1000 + $4/1000 }' <<<"$1"
}

echo "VoxHarbor load test: dial $DIAL, $CALLS calls/stage, hold ${HOLD} ms, max $LIMIT concurrent"
echo "Host: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs), $(nproc) vCPU, $(free -h | awk '/Mem:/{print $2}') RAM"
echo
printf '| %-8s | %-6s | %-7s | %-6s | %-9s | %-12s | %-12s | %-34s |\n' \
  "Rate" "Calls" "Success" "Failed" "Success %" "Setup avg" "Peak calls" "Peak CPU (kamailio/fs1/fs2/rtpengine)"
printf '|%s|\n' "----------|--------|---------|--------|-----------|--------------|--------------|------------------------------------"

for rate in $RATES; do
  docker exec kamailio kamcmd htable.delete ipban 172.28.0.50 >/dev/null 2>&1 || true
  docker exec sipp sh -c 'rm -f /tmp/lt.csv /sipp/*_errors.log' >/dev/null 2>&1 || true

  # sample CPU of each container every ~2s while SIPp runs; keep the peak
  : > "$TMP/cpu"
  ( while :; do
      docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' $WATCH 2>/dev/null >> "$TMP/cpu" || true
    done ) & sampler=$!

  set +e
  docker exec sipp sipp "$PROXY" -sf scenarios/uac_auth.xml -s "$DIAL" \
    -key caller 1010 -au 1010 -ap "$PW" -d "$HOLD" \
    -r "$rate" -m "$CALLS" -l "$LIMIT" -nostdin -timeout $(( CALLS / rate + 60 )) \
    -trace_stat -stf /tmp/lt.csv -fd 1 >/dev/null 2>&1
  set -e
  kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null || true

  docker cp sipp:/tmp/lt.csv "$TMP/lt.csv" >/dev/null
  ok=$(csv_field "$TMP/lt.csv" "SuccessfulCall(C)")
  ko=$(csv_field "$TMP/lt.csv" "FailedCall(C)")
  rt=$(to_ms "$(csv_field "$TMP/lt.csv" "ResponseTime1(C)")")
  peak=$(awk -F';' 'NR==1{for(i=1;i<=NF;i++) if($i=="CurrentCall") c=i; next} $c>m{m=$c} END{print m+0}' "$TMP/lt.csv")
  pct=$(awk -v a="$ok" -v b="$ko" 'BEGIN{ t=a+b; printf "%.1f", t ? 100*a/t : 0 }')
  cpu=$(for c in kamailio fs1 fs2 rtpengine; do
          awk -v n="$c" '$1==n{v=$2; sub("%","",v); if(v+0>m) m=v+0} END{printf "%.0f%%\n", m}' "$TMP/cpu"
        done | paste -sd/)

  printf '| %-8s | %-6s | %-7s | %-6s | %-9s | %-12s | %-12s | %-34s |\n' \
    "$rate cps" "$CALLS" "$ok" "$ko" "$pct" "${rt} ms" "$peak" "$cpu"
done

echo
echo "Memory after test:"
docker stats --no-stream --format '  {{.Name}}: {{.MemUsage}}' $WATCH
