#!/bin/bash
# Runs once on first MySQL start (empty data volume).
# - Kamailio's DB user gets mysql_native_password (compatible with Kamailio's client lib)
# - Subscribers 1001-1099 are stored as HA1 hashes only (password column left empty)
set -euo pipefail
: "${SIP_REALM:?SIP_REALM missing}" "${SIP_USER_PASSWORD:?SIP_USER_PASSWORD missing}"

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" kamailio <<SQL
ALTER USER '${MYSQL_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_PASSWORD}';

INSERT INTO subscriber (username, domain, password, ha1, ha1b)
WITH RECURSIVE n(i) AS (SELECT 1001 UNION ALL SELECT i + 1 FROM n WHERE i < 1099)
SELECT i, '${SIP_REALM}', '',
       MD5(CONCAT(i, ':', '${SIP_REALM}', ':', '${SIP_USER_PASSWORD}')),
       MD5(CONCAT(i, '@', '${SIP_REALM}', ':', '${SIP_REALM}', ':', '${SIP_USER_PASSWORD}'))
FROM n;
SQL
echo "voxharbor: provisioned $(mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -N -e 'SELECT COUNT(*) FROM kamailio.subscriber') subscribers"
