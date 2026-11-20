#!/usr/bin/env bash
# VoxHarbor failover test: kill a FreeSWITCH node in the middle of a call load and
# measure what the caller experiences, then restart it and measure the rejoin.
#
# Usage: scripts/failover-test.sh [-n 60] [-r 2] [-k 8] [-v fs1]
#   -n  calls in the run          -r  calls per second
#   -k  seconds before the kill   -v  node to kill (fs1 or fs2)
set -euo pipefail
cd "$(dirname "$0")/.."

CALLS=60; RATE=2; KILL_AFTER=8; VICTIM=fs1
while getopts "n:r:k:v:h" opt; do
  case $opt in
    n) CALLS=$OPTARG ;; r) RATE=$OPTARG ;; k) KILL_AFTER=$OPTARG ;; v) VICTIM=$OPTARG ;;
    *) sed -n '2,8p' "$0"; exit 0 ;;
  esac
done
case $VICTIM in fs1) VIP=172.28.0.31 ;; fs2) VIP=172.28.0.32 ;; *) echo "victim must be fs1 or fs2" >&2; exit 1 ;; esac

PROXY=172.28.0.10:5060
PW=$(grep -E '^SIP_USER_PASSWORD=' .env | cut -d= -f2-)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
csv_field() { awk -F';' -v col="$2" 'NR==1{for(i=1;i<=NF;i++) if($i==col) c=i} END{print $c}' "$1"; }
ds_flags() { docker exec kamailio kamcmd dispatcher.list | grep -A4 "sip:$1:5080" | awk '/FLAGS/{print $2; exit}'; }
count_calls() { docker logs --since "$1" "$2" 2>&1 | grep -c 'New Channel sofia/internal/1020' || true; }
wait_active() { # $1 = node ip, $2 = timeout s -> prints seconds taken
  local t0 now; t0=$(date +%s)
  until [ "$(ds_flags "$1")" = "AP" ]; do
    now=$(date +%s); [ $((now - t0)) -ge "$2" ] && { echo "timeout"; return; }
    sleep 1
  done
  echo $(( $(date +%s) - t0 ))
}

docker compose up -d sipp >/dev/null 2>&1
docker exec kamailio kamcmd htable.delete ipban 172.28.0.50 >/dev/null 2>&1 || true
echo "Waiting for both FreeSWITCH nodes to be active..."
for ip in 172.28.0.31 172.28.0.32; do [ "$(wait_active $ip 60)" = timeout ] && { echo "node $ip not active" >&2; exit 1; }; done

echo "Running $CALLS calls to 9999 at $RATE cps; stopping $VICTIM after ${KILL_AFTER}s"
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker exec sipp sh -c 'rm -f /tmp/fo.csv'
( docker exec sipp sipp "$PROXY" -sf scenarios/uac_auth.xml -s 9999 -key caller 1020 -au 1020 -ap "$PW" \
    -d 1500 -r "$RATE" -m "$CALLS" -l 30 -nostdin -timeout $(( CALLS / RATE + 60 )) \
    -trace_stat -stf /tmp/fo.csv -fd 1 >/dev/null 2>&1 || true ) &
SIPP=$!

sleep "$KILL_AFTER"
KILL_TS=$(date -u +%T)
docker stop -t 0 "$VICTIM" >/dev/null
echo "  $KILL_TS UTC  docker stop $VICTIM"
DOWN=$(date +%s)
until [ "$(ds_flags "$VIP")" != "AP" ]; do sleep 0.5; [ $(( $(date +%s) - DOWN )) -gt 60 ] && break; done
echo "  $VICTIM marked $(ds_flags "$VIP") by Kamailio after $(( $(date +%s) - DOWN ))s"

wait "$SIPP"
docker cp sipp:/tmp/fo.csv "$TMP/fo.csv" >/dev/null
OK=$(csv_field "$TMP/fo.csv" "SuccessfulCall(C)"); KO=$(csv_field "$TMP/fo.csv" "FailedCall(C)")
RETRIES=$(docker logs --since "$START" kamailio 2>&1 | grep -c "retrying 9999" || true)
FS1=$(count_calls "$START" fs1); FS2=$(count_calls "$START" fs2)

echo "Restarting $VICTIM..."
docker start "$VICTIM" >/dev/null
REJOIN=$(wait_active "$VIP" 90)

AFTER=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker exec sipp sipp "$PROXY" -sf scenarios/uac_auth.xml -s 9999 -key caller 1020 -au 1020 -ap "$PW" \
  -d 1000 -r 4 -m 10 -l 10 -nostdin -timeout 40 >/dev/null 2>&1 || true
A1=$(count_calls "$AFTER" fs1); A2=$(count_calls "$AFTER" fs2)

echo
echo "| Metric | Value |"
echo "|---|---|"
echo "| Calls attempted | $CALLS at $RATE cps |"
echo "| Successful / failed | $OK / $KO |"
echo "| Calls answered by fs1 / fs2 | $FS1 / $FS2 |"
echo "| Calls retried on the surviving node (instant retry) | $RETRIES |"
echo "| $VICTIM rejoined (flag AP) after docker start | ${REJOIN}s |"
echo "| 10 calls after rejoin, fs1 / fs2 | $A1 / $A2 |"
