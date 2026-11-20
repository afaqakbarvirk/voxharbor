# VoxHarbor — Test Results

Lab host: Intel Core i7-10750H (12 threads visible to WSL), Windows 10 Pro (19045) + WSL2 Ubuntu 26.04, kernel 6.18, 7.6 GiB RAM, Docker 29.10.0 / Compose v5.8.0, WSL networking: NAT.

## Phase 1 — Single PBX (2026-11-17)

- FreeSWITCH 1.10.12 (Alpine 3.22 package) as `fs1`, digest auth on its own directory.
- SIPp, authenticated INVITE to 9196 echo test: **200 OK, call completed**.
- SIPp, wrong password: **403 Forbidden**.
- Manual two-way audio gate (1001 → 1002 on softphones): **not run**. The user chose to move on to Phase 2 without it.

## Phase 2 — Kamailio in front (2026-11-17)

- Kamailio 6.0.6 registrar + digest auth against MySQL 8.4.7, with passwords stored as HA1 only (`password` column empty).
- FreeSWITCH: no registrations, no auth, SIP accepted only from 172.28.0.10 (ACL).

| Check (SIPp container → Kamailio 172.28.0.10:5060) | Result |
|---|---|
| REGISTER 1001 with wrong password | 403 Forbidden ✅ |
| REGISTER 1002 with correct password | 200 OK ✅ |
| INVITE 1001 → 9196 (Kamailio → fs1 echo) | 200 OK, BYE 200 ✅ |
| INVITE 1001 → 1002 (Kamailio → fs1 → Kamailio `lookup` → UAS) | 200 OK, BYE 200 ✅ |
| INVITE sent straight to fs1, bypassing Kamailio | 403 Forbidden (ACL) ✅ |

### Phase 2 follow-up: browser (WebRTC) audio (2026-11-19)

- Symptom: browser echo call connected, but no audio (0 packets).
- Cause 1: FreeSWITCH accepts only public ICE candidates by default (`wan.auto`), so it rejected the browser's offer with 488. Fixed with `apply-candidate-acl` set to `rfc1918.auto` plus `wan.auto`.
- Cause 2: FreeSWITCH advertised its container IP 172.28.0.31 in the SDP, because `ext-rtp-ip` only takes effect when `ext-sip-ip` is also set. Fixed by setting `ext-sip-ip` to fs1's own internal IP.
- Result: browser → Kamailio → fs1 echo test completes the DTLS handshake (HANDSHAKE → READY in 40 ms), and the user confirmed hearing their echo. ✅

## Phase 3: Load balancing + failover (2026-11-19)

- Second node `fs2` (172.28.0.32) runs the same config folder as fs1.
- Kamailio dispatcher set 1 = fs1 + fs2, round-robin (algorithm 4). OPTIONS health checks every 10 s, probing mode 1, a node changes state after 2 failed or 2 successful checks.
- Loop prevention uses `ds_is_from_list("1")`. Instant retry: a 408/5xx, or no reply within 2 s, triggers `ds_mark_dst("ip")` then `ds_next_dst()`.
- Until rtpengine arrives in Phase 4, RTP is published straight to the host, so each node has its own range: fs1 16384-16484, fs2 16500-16600.

| Test (SIPp → Kamailio) | Result |
|---|---|
| 20 calls to 9999 at 4 cps | 20/20 OK, **fs1 10 / fs2 10** ✅ |
| 40 calls at 2 cps, `docker stop fs1` at 6 s | **39/40 OK** (1 call in progress on fs1 dropped). Kamailio logged `fs1 failed (408), marking down` → `retrying on fs2`. fs1 flagged `IP` ✅ |
| `docker start fs1` | back to `AP` in **4 s**. The next 10 calls split **5 / 5** ✅ |
| 1001 → 1002 (phone → Kamailio → FS → Kamailio → phone) ×2 | 2/2 OK, no loop ✅ |

## Phase 4: Media relay + security (2026-11-20)

- rtpengine 12.2.1.4 (Alpine, userspace forwarding) at 172.28.0.20. Kamailio controls it over ng (2223/udp, voxnet only).
- Two logical interfaces on one address: `internal` (FreeSWITCH side) and `external!<host IP>` (phone side). Only RTP 30000-30100 is published to the host. FreeSWITCH is no longer reachable from the host for SIP or RTP.
- Kamailio runs `rtpengine_manage` on both legs. The phone side gets WebRTC (DTLS-SRTP, ICE, rtcp-mux) for browsers and plain RTP otherwise; the FreeSWITCH side always gets plain RTP/AVP. Codecs are restricted to Opus/PCMU/PCMA (+ telephone-event).
- Security: `pike` (>250 requests per 2 s from one IP) feeds an `htable` ban list (5 min). Scanner User-Agents are dropped silently. FreeSWITCH nodes and the WebSocket proxy are exempt.

| Test | Result |
|---|---|
| SIPp → 9196 with real audio (`g711a.pcap`) | Phone leg `30004`: **in 236 / out 219 pkts**. fs2 leg `30062↔16386`: **in 219 / out 236**. Audio relayed both ways ✅ |
| Phone-side SDP | `c=192.168.159.121`, port in 30000-30100 ✅ (FreeSWITCH sees `172.28.0.20`) |
| WebRTC-style offer → 9196 | Answer `UDP/TLS/RTP/SAVPF` with rtpengine fingerprint, ICE candidate on host IP, `setup:passive` ✅ |
| IVR 5000 + RFC 2833 DTMF "1" through rtpengine | FreeSWITCH `RECV DTMF 1` → transfer to echo ✅ |
| OPTIONS with UA `friendly-scanner` / `SIPVicious 0.3.4` / `sipcli/v1.8` | No response (dropped, logged) ✅. A normal UA gets 200 ✅ |
| Flood: 3000 OPTIONS at 500/s from 172.28.0.66 | Banned at request **#510 (~1 s)**. Every later request from that IP is ignored; other clients unaffected ✅ |
| Regression: 10× 9999, 1001→1002 | 5/5 split, call OK ✅ |

## Phase 5: Load and failover proof (2026-11-20)

Hardware: Intel Core i7-10750H @ 2.60 GHz (12 vCPU visible to WSL2), 7.6 GiB RAM, Windows 10 Pro + WSL2 Ubuntu 26.04, Docker 29.10.0. Everything runs on one laptop, SIPp included.

### Load: `scripts/load-test.sh` (SIPp → Kamailio → rtpengine → fs1/fs2 echo, 1 s hold)

| Rate | Calls | Success | Failed | Success % | Setup avg (INVITE → 200, incl. auth round) | Peak concurrent | Peak CPU kamailio / fs1 / fs2 / rtpengine |
|---|---|---|---|---|---|---|---|
| 5 cps | 200 | 200 | 0 | 100.0 | 8.0 ms | 6 | 6% / 8% / 8% / 1% |
| 10 cps | 200 | 200 | 0 | 100.0 | 8.0 ms | 11 | 7% / 10% / 11% / 2% |
| 20 cps | 200 | 200 | 0 | 100.0 | 8.0 ms | 21 | 6% / 10% / 14% / 3% |

Memory after the run: Kamailio 24 MiB, fs1 29 MiB, fs2 29 MiB, rtpengine 7.5 MiB, MySQL 474 MiB.

What limits the rate here is the lab's own configuration, not CPU:
- `pike` bans one source IP above 250 requests per 2 s, which is about 25 calls/s from a single SIPp.
- The 101-port RTP range carries about 25 concurrent calls.

Both are deliberate settings; raise them (and use several load sources) to push further. These runs are signalling-only. Real audio through the relay is proven separately in Phase 4.

### Failover: `scripts/failover-test.sh` (60 calls to 9999 at 2 cps, `docker stop -t 0 fs1` after 8 s)

| Metric | Value |
|---|---|
| Successful / failed | **58 / 2**. The 2 failures were calls in progress on fs1 at the moment it was killed |
| fs1 detected down by Kamailio | **≤ 2 s** (the first INVITE to it timed out, then `ds_mark_dst`) |
| New calls retried instantly on fs2 | 2 |
| Calls answered by fs1 / fs2 | 8 / 52 |
| fs1 back in rotation after `docker start` | **4 s** |
| 10 calls after rejoin, fs1 / fs2 | **5 / 5** |
