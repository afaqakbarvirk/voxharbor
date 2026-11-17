# VoxHarbor — Test Results

Lab host: Windows 10 Pro (19045) + WSL2 Ubuntu 26.04, kernel 6.18, 7.6 GiB RAM, Docker 29.10.0 / Compose v5.8.0, WSL networking: NAT.

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
