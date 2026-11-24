#!/usr/bin/env bash
# Executar com a pilha ativa: cada serviço alcança seu MiniStack e não resolve os demais.
set -euo pipefail

check_dns() {
  local service="$1" host="$2" expected="$3"
  local result
  case "$service" in
    campaigns|identity)
      result=$(docker compose exec -T "$service" node -e '
        require("node:dns").lookup(process.argv[1], error => {
          process.stdout.write(error ? "absent" : "present");
        });' "$host") ;;
    characters)
      result=$(docker compose exec -T characters python -c '
import socket, sys
try:
    socket.getaddrinfo(sys.argv[1], 4566)
    print("present")
except socket.gaierror:
    print("absent")' "$host") ;;
    inventory)
      # A imagem Java tem curl; o resultado DNS é 6 quando o nome não existe.
      if docker compose exec -T inventory curl -sS --max-time 3 -o /dev/null "http://$host:4566" 2>/dev/null; then
        result=present
      else
        result=absent
      fi ;;
  esac
  if [ "$result" != "$expected" ]; then
    printf 'FALHOU: %s -> %s: %s; esperado %s\n' "$service" "$host" "$result" "$expected" >&2
    exit 1
  fi
  printf 'OK: %s -> %s: %s\n' "$service" "$host" "$result"
}

services=(campaigns characters inventory identity)
hosts=(ministack-campaigns ministack ministack-inventory ministack-identity)
for i in 0 1 2 3; do
  for j in 0 1 2 3; do
    expected=absent
    [ "$i" -eq "$j" ] && expected=present
    check_dns "${services[$i]}" "${hosts[$j]}" "$expected"
  done
done
