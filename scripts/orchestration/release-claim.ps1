[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Acquire','Release')][string]$Action, [Parameter(Mandatory)][string]$Agent, [string]$LeaseToken, [ValidateRange(1,86400)][int]$TtlSeconds=7200)
$ErrorActionPreference='Stop'; $root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path; $dir=Join-Path $root 'docs\implementation\recurring-to-source\.claims'; $target=Join-Path $dir 'live-stack.json'
$mutex=[System.Threading.Mutex]::new($false,'Global\tastile-recurring-to-source-claims'); $hasMutex=$false
try {
    try { $hasMutex=$mutex.WaitOne([TimeSpan]::FromSeconds(30)) } catch [System.Threading.AbandonedMutexException] { $hasMutex=$true }; if(-not $hasMutex){throw 'Timed out waiting for the claim registry.'}
    [System.IO.Directory]::CreateDirectory($dir)|Out-Null; $now=[DateTime]::UtcNow
    if($Action -eq 'Release') {
        if(-not(Test-Path -LiteralPath $target)){throw 'No live-stack claim exists.'}; $prior=Get-Content -LiteralPath $target -Raw|ConvertFrom-Json
        if(-not $LeaseToken -or $prior.releaseState -ne 'active' -or $prior.agent -ne $Agent -or $prior.leaseToken -ne $LeaseToken){throw 'Only the active owner with the matching lease token may release live-stack.'}
        $claim=[ordered]@{id='live-stack';agent=$prior.agent;fileGlob=@('live-stack');acquiredUtc=$prior.acquiredUtc;expiresUtc=$prior.expiresUtc;leaseToken=$prior.leaseToken;releaseState='released';releasedUtc=$now.ToString('o')}
    } else {
        if(Test-Path -LiteralPath $target){$prior=Get-Content -LiteralPath $target -Raw|ConvertFrom-Json;if($prior.releaseState -eq 'active' -and [DateTime]$prior.expiresUtc -gt $now){throw "live-stack is actively claimed by '$($prior.agent)' until $($prior.expiresUtc)."}}
        $claim=[ordered]@{id='live-stack';agent=$Agent;fileGlob=@('live-stack');acquiredUtc=$now.ToString('o');expiresUtc=$now.AddSeconds($TtlSeconds).ToString('o');leaseToken=[guid]::NewGuid().ToString('N');releaseState='active'}
    }
    $tmp=Join-Path $dir ('.live-stack.'+[guid]::NewGuid().ToString('N')+'.tmp'); [System.IO.File]::WriteAllText($tmp,($claim|ConvertTo-Json -Depth 3),[System.Text.UTF8Encoding]::new($false)); [System.IO.File]::Move($tmp,$target,$true); $claim|ConvertTo-Json -Depth 3
} finally {if($hasMutex){$mutex.ReleaseMutex()};$mutex.Dispose()}
