# VoxHarbor architecture

VoxHarbor separates **signalling** from **media**, the same split that carrier and hosted-PBX platforms use:

- **Kamailio** decides *where* a call goes. It handles authentication, load balancing and security, and never touches audio.
- **rtpengine** carries the audio, fixes NAT, and converts browser WebRTC media to plain RTP and back.
- **FreeSWITCH** (×2) runs the applications: echo test, IVR and bridging. It only ever talks to Kamailio and rtpengine.

```mermaid
flowchart LR
    subgraph clients[Clients]
        SP[SIP softphone<br/>MicroSIP / Zoiper]
        BR[Browser console<br/>JsSIP + WebRTC]
        SIPP[SIPp<br/>load & failover tests]
    end

    subgraph voxnet[Docker network voxnet 172.28.0.0/24]
        NG[nginx web<br/>.60 :80 → /ws]
        K[Kamailio .10<br/>registrar · auth · dispatcher<br/>pike · scanner filter]
        R[rtpengine .20<br/>media relay · NAT · WebRTC↔RTP]
        DB[(MySQL .40<br/>subscriber HA1 · location)]
        F1[FreeSWITCH fs1 .31]
        F2[FreeSWITCH fs2 .32]
    end

    SP -- SIP 5060/udp --> K
    BR -- HTTP + WS 8080 --> NG -- SIP over WS 8088 --> K
    SIPP -- SIP --> K
    K -- SQL --> DB
    K -- ng 2223/udp --> R
    K -- "SIP 5070 → 5080<br/>round-robin + health checks" --> F1 & F2

    SP <-. RTP 30000-30100 .-> R
    BR <-. DTLS-SRTP + ICE .-> R
    R <-. RTP 16384-16484 .-> F1 & F2
```

Solid lines are signalling; dotted lines are media.

## Components

| Container | IP | Role | Published to host |
|---|---|---|---|
| `kamailio` | 172.28.0.10 | SIP proxy, registrar, digest auth (MySQL, HA1), dispatcher, rtpengine control, flood/scanner protection | 5060 udp/tcp |
| `rtpengine` | 172.28.0.20 | Media relay. Two logical interfaces: `internal` (towards FreeSWITCH) and `external!<host IP>` (towards phones) | RTP 30000-30100/udp |
| `fs1`, `fs2` | 172.28.0.31/.32 | FreeSWITCH B2BUA nodes running the same mounted config. SIP accepted only from Kamailio (ACL) | none |
| `mysql` | 172.28.0.40 | Kamailio schema: `subscriber` (HA1 only), `location` | none |
| `web` | 172.28.0.60 | nginx: browser console + `/ws` proxy to Kamailio's WebSocket listener | 8080 |
| `sipp` | 172.28.0.50 | SIPp, sngrep and tcpdump toolbox for the tests | none |

Every image is pinned: Alpine 3.22 packages for Kamailio 6.0.6, FreeSWITCH 1.10.12, rtpengine 12.2.1.4 and SIPp 3.7.3; `mysql:8.4.7`; `nginx:1.27.5-alpine`.

## Kamailio sockets

Kamailio listens on separate sockets for each side, so the two legs of a call never get mixed up:

| Socket | Faces | Notes |
|---|---|---|
| `udp/tcp 172.28.0.10:5060` advertised as `<host IP>:5060` | phones | Record-Route and Via carry the host IP that phones can reach |
| `udp 172.28.0.10:5070` | FreeSWITCH | dispatcher pings and dispatched INVITEs leave from here |
| `tcp 172.28.0.10:8088` | nginx `/ws` | SIP over WebSocket for browsers |

Because the inbound and outbound sockets differ, `record_route()` inserts two Record-Route headers, so in-dialog requests come back on the correct side.

## Call flows

### Registration with digest auth

```mermaid
sequenceDiagram
    participant P as Phone 1001
    participant K as Kamailio
    participant D as MySQL
    P->>K: REGISTER
    K-->>P: 401 (realm voxharbor, nonce)
    P->>K: REGISTER + Authorization
    K->>D: SELECT ha1 FROM subscriber WHERE username=1001
    alt digest matches HA1
        K->>K: save("location"), fix_nated_register()
        K-->>P: 200 OK
    else wrong password / unknown user
        K-->>P: 403 Forbidden
    end
```

Passwords never appear in the database: `02-subscribers.sh` stores only `MD5(user:realm:password)`.

### Phone to phone (loop prevention)

FreeSWITCH is a B2BUA, so a call between two phones crosses Kamailio twice. The first rule in the request route decides which way a request goes:

```mermaid
sequenceDiagram
    participant A as Phone 1001
    participant K as Kamailio
    participant R as rtpengine
    participant F as fs1 / fs2
    participant B as Phone 1002
    A->>K: INVITE 1002 (auth)
    K->>R: offer (external → internal)
    K->>F: INVITE (ds_select_dst, round-robin)
    F->>K: INVITE 1002 (B-leg)
    Note over K: ds_is_from_list(1) is true:<br/>lookup("location"), no auth, no dispatch
    K->>R: offer (internal → external)
    K->>B: INVITE
    B-->>K: 200 OK
    K-->>F: 200 OK (answer via rtpengine)
    F-->>K: 200 OK
    K-->>A: 200 OK (answer via rtpengine)
```

Without `ds_is_from_list()`, the B-leg would be authenticated and dispatched straight back to FreeSWITCH, and the call would loop.

### Failover

```mermaid
sequenceDiagram
    participant A as Caller
    participant K as Kamailio
    participant F1 as fs1 (dead)
    participant F2 as fs2
    A->>K: INVITE 9999
    K->>F1: INVITE (t_set_fr: 2 s to first reply)
    Note over K,F1: no 100 Trying in 2 s → 408
    K->>K: failure_route: ds_mark_dst("ip") → fs1 inactive + probing
    K->>F2: ds_next_dst() → INVITE
    F2-->>K: 200 OK
    K-->>A: 200 OK
    loop every 10 s
        K->>F1: OPTIONS (probing mode 1)
    end
    Note over K,F1: after docker start: 2 good replies → active again
```

- **Health checks:** OPTIONS every 10 s (`ds_ping_interval`). A node changes state after 2 failures or 2 successes (`ds_probing_threshold` / `ds_inactive_threshold`).
- **Instant retry:** a 408 or 5xx, or no provisional reply within 2 s, marks the node down and re-sends the INVITE to the next node. The caller just sees a slightly slower ring.
- **Calls already in progress** on a node that dies are lost: FreeSWITCH holds that call state. Surviving them would need shared call state or SIP re-INVITE recovery, which is out of scope here.

### Media path and WebRTC

Kamailio runs `rtpengine_manage()` on both legs. Since every dialog is phone ↔ FreeSWITCH, the direction is decided by where a message comes from:

| Message from | rtpengine direction | Profile on the outgoing side |
|---|---|---|
| A phone or browser | `external → internal` | FreeSWITCH always gets plain `RTP/AVP`, ICE removed, rtcp-mux demuxed |
| FreeSWITCH, to a SIP phone | `internal → external` | plain `RTP/AVP` |
| FreeSWITCH, to a browser (WS contact or SAVPF caller) | `internal → external` | `UDP/TLS/RTP/SAVPF`, ICE forced, DTLS passive, rtcp-mux |

So FreeSWITCH never sees WebRTC, and a browser can call a SIP phone or another browser. Codecs are restricted to Opus, PCMU and PCMA (plus telephone-event for DTMF) with `codec-strip=all codec-except=...`. RFC 2833 DTMF passes through rtpengine to the IVR.

## Security layers

| Layer | Where | What it does |
|---|---|---|
| Scanner filter | Kamailio `route[SECURITY]` | Drops requests whose User-Agent matches friendly-scanner, sipvicious, sipcli, sipsak and similar. No reply is sent, so scanners learn nothing |
| Flood ban | `pike` + `htable ipban` | More than 250 requests per 2 s from one IP bans it for 300 s; later packets are dropped before any processing. FreeSWITCH nodes and the WS proxy are exempt |
| Digest auth | `auth_db` | Every request from the phone side must authenticate. A wrong password gets 403 |
| FreeSWITCH ACL | `acl.conf.xml` | FreeSWITCH accepts SIP only from 172.28.0.10. A direct INVITE gets 403 |
| Network exposure | docker-compose | MySQL, FreeSWITCH and the rtpengine control port are never published to the host |
| Secrets | `.env` (gitignored) | DB passwords and the SIP password. `.env.example` ships placeholders |

## Port map

| Host port | Container | Purpose |
|---|---|---|
| 5060/udp, 5060/tcp | kamailio | SIP from softphones |
| 8080/tcp | web | browser console + SIP over WebSocket (`/ws`) |
| 30000-30100/udp | rtpengine | RTP / SRTP to phones and browsers |

## Lab-specific choices

- **WSL2 in NAT mode (Windows 10):** softphones on the Windows host reach WSL at its NAT IP. That IP goes in `.env` as `EXTERNAL_IP` and becomes Kamailio's advertised address and rtpengine's external interface. It can change after a WSL restart.
- **Browsers** only grant microphone access on `https://` or `http://localhost`, so the console is served on `localhost:8080`, which WSL forwards to the host.
- **rtpengine runs in userspace** (`table = -1`): WSL has no `xt_RTPENGINE` kernel module. That's fine at lab scale.
- **The RTP range of 101 ports** carries about 25 simultaneous calls (4 ports per call). Widen `port-min`/`port-max` and the published range for more.
