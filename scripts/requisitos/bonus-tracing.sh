#!/usr/bin/env bash
# Compra real e confirma, no Jaeger, um trace compartilhado por S1, S2, S3 e S4.
source "$(dirname "$0")/lib.sh"

titulo "Bônus — trace distribuído nos quatro serviços"
preparar_cenario
ITEM="$(criar_item "Item rastreado" 10 10)"
comprar "$ITEM"
confere "a compra foi aceita" [ "$HTTP_CODE" = "202" ]
confere "a Saga terminou em COMPLETED" [ "$(espera_fim_compra "$OPERACAO" 60)" = "COMPLETED" ]

docker compose exec -T characters python - "$OPERACAO" <<'PY'
import json
import sys
import time
from urllib.request import urlopen

operation_id = sys.argv[1]
url = "http://jaeger:16686/api/traces?service=inventory&lookback=1h&limit=100"
required = {"inventory", "characters", "campaigns", "identity", "identity-validator"}
for attempt in range(40):
    try:
        with urlopen(url, timeout=5) as response:
            traces = json.load(response).get("data", [])
        for trace in traces:
            if operation_id not in json.dumps(trace):
                continue
            services = {process["serviceName"] for process in trace.get("processes", {}).values()}
            if required <= services:
                print(f"Trace {trace['traceID']} — serviços: {', '.join(sorted(services))}")
                print("Abra http://localhost:16686/trace/" + trace["traceID"])
                sys.exit(0)
            print("Aguardando spans no trace", trace["traceID"], "presentes:", sorted(services))
    except Exception as error:
        print("Aguardando Jaeger:", error)
    time.sleep(2)
print("Nenhum trace da compra reuniu S1, S2, S3 e S4 no Jaeger.", file=sys.stderr)
sys.exit(1)
PY
resultado_final "Trace distribuído"
