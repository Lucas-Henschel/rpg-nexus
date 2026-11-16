param(
    [string]$BaseUrl = 'http://localhost:8080',
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$suffix = [guid]::NewGuid().ToString('N')
$campaignId = "smoke_$suffix"
$itemId = "item_$suffix"
$characterId = "missing_$suffix"

function Request-Json($Method, $Path, $Body, $Headers = @{}) {
    $args = @{ Method = $Method; Uri = "$base$Path"; Headers = $Headers; TimeoutSec = 15 }
    if ($null -ne $Body) {
        $args.ContentType = 'application/json'
        $args.Body = ConvertTo-Json -InputObject $Body -Compress
    }
    Invoke-RestMethod @args
}

$ready = $false
$startupLimit = (Get-Date).AddSeconds(60)
do {
    try {
        $health = Request-Json GET '/health' $null
        $ready = $health.status -eq 'UP'
    } catch {
        Start-Sleep -Seconds 2
    }
} while (-not $ready -and (Get-Date) -lt $startupLimit)
if (-not $ready) { throw 'Inventory did not respond in 60 s. Run: docker compose ps; docker compose logs --tail=100 inventory inventory-init' }
if ($health.status -ne 'UP') { throw "Health inesperado: $($health.status)" }
Write-Host 'Inventory healthy. Creating item and stock...'
Request-Json POST '/items' @{ itemId = $itemId; name = 'Item de teste' } | Out-Null
Request-Json POST '/stocks' @{ campaignId = $campaignId; itemId = $itemId; available = 1 } | Out-Null

$headers = @{ 'Idempotency-Key' = "smoke_$suffix" }
$body = @{ campaignId = $campaignId; characterId = $characterId; itemId = $itemId }
Write-Host 'Requesting acquisition and replaying idempotency key...'
$first = Request-Json POST '/acquisitions' $body $headers
$replay = Request-Json POST '/acquisitions' $body $headers
if (-not $first.operationId -or $first.operationId -ne $replay.operationId) {
    throw 'Idempotência HTTP falhou'
}

$limit = (Get-Date).AddSeconds($TimeoutSeconds)
do {
    $operation = Request-Json GET "/acquisitions/$($first.operationId)" $null
    if ($operation.status -in @('COMPENSATED', 'EXPIRED', 'REJECTED', 'COMPLETED')) { break }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $limit)

$stock = Request-Json GET "/stocks/$campaignId/$itemId" $null
if ($operation.status -notin @('COMPENSATED', 'EXPIRED')) {
    throw "Estado terminal esperado COMPENSATED ou EXPIRED; recebido $($operation.status). Confira S2/RabbitMQ e os logs."
}
if ($stock.available -ne 1) { throw "Compensação falhou: saldo esperado 1, recebido $($stock.available)" }

Write-Host "OK: health, creation, idempotency and compensation. operationId=$($first.operationId), status=$($operation.status), stock=$($stock.available)"
