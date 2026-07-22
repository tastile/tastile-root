$ErrorActionPreference = 'Continue'
$instanceId = 'i-0ec20b65596468a79'

$cmd = @'
echo "=== api version (any version-like file) ==="
find /opt/tastile/api -maxdepth 3 -name 'version*' 2>/dev/null | head -5
echo
echo "=== api current symlink target ==="
ls -la /opt/tastile/api/current 2>&1 | head -3
echo
echo "=== api version.txt or VERSION ==="
cat /opt/tastile/api/current/version.txt 2>&1 || true
cat /opt/tastile/api/current/VERSION 2>&1 || true
cat /opt/tastile/api/VERSION 2>&1 || true
echo
echo "=== full /etc/tastile/tastile.env (keys only) ==="
sed 's/=.*/=<SET>/' /etc/tastile/tastile.env 2>&1 | head -30
echo
echo "=== full /etc/tastile/tastile-web.env (keys only) ==="
sed 's/=.*/=<SET>/' /etc/tastile/tastile-web.env 2>&1 | head -30
echo
echo "=== bridge secret equality (length + hash) ==="
api_secret=$(grep -E '^TASTILE_WEB_BRIDGE_SECRET=' /etc/tastile/tastile.env | cut -d= -f2-)
web_secret=$(grep -E '^TASTILE_WEB_BRIDGE_SECRET=' /etc/tastile/tastile-web.env | cut -d= -f2-)
echo "api_secret_len=${#api_secret}"
echo "web_secret_len=${#web_secret}"
if [ "$api_secret" = "$web_secret" ]; then echo "MATCH"; else echo "DIFFER"; fi
echo
echo "=== systemctl api status (last 5 lines) ==="
systemctl status tastile-api --no-pager 2>&1 | tail -10
echo
echo "=== journald last 30 lines for tastile-api ==="
journalctl -u tastile-api --no-pager -n 30 2>&1
'@

$tmpJson = [System.IO.Path]::GetTempFileName() + ".json"
@{ commands = @($cmd) } | ConvertTo-Json -Compress | Out-File -FilePath $tmpJson -Encoding ascii -NoNewline

$cidOut = cmd.exe /c "aws ssm send-command --instance-ids $instanceId --document-name AWS-RunShellScript --parameters file://$tmpJson --region ap-northeast-1 --output json" 2>&1
Remove-Item $tmpJson -Force

$cid = ($cidOut | Select-String -Pattern '"CommandId":\s*"([a-f0-9-]+)"' -AllMatches).Matches[0].Groups[1].Value
Write-Host "CommandId: $cid"

Start-Sleep -Seconds 8
$invOut = cmd.exe /c "aws ssm get-command-invocation --command-id $cid --instance-id $instanceId --region ap-northeast-1 --output json" 2>&1

# Extract StandardOutputContent - it's a JSON string with \n escapes
$jsonText = $invOut -replace '^System\.Management\.Automation\.RemoteException\s*', ''
try {
    $parsed = $jsonText | ConvertFrom-Json
    Write-Host "STATUS:" $parsed.Status
    Write-Host "---STDOUT---"
    Write-Host $parsed.StandardOutputContent
    if ($parsed.StandardErrorContent) {
        Write-Host "---STDERR---"
        Write-Host $parsed.StandardErrorContent
    }
} catch {
    Write-Host "Parse error. Raw:"
    Write-Host $jsonText
}