[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BatchId,
    [Parameter(Mandatory)][string]$Agent,
    [Parameter(Mandatory)][ValidateSet('CoreFmt','CoreClippy','CoreTests','WebCheck','WebBuild','AndroidUnit')][string]$ApprovedCommand,
    [Parameter(Mandatory)][string]$Specification,
    [Parameter(Mandatory)][string]$EvidencePath
)
$ErrorActionPreference='Stop'; $root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$claimPath=Join-Path $root ('docs\implementation\recurring-to-source\.claims\'+$BatchId+'.json')
if(-not(Test-Path -LiteralPath $claimPath)){throw "Missing claim for batch '$BatchId'."}; $claim=Get-Content -LiteralPath $claimPath -Raw|ConvertFrom-Json
if($claim.agent -ne $Agent -or $claim.releaseState -ne 'active' -or [DateTime]$claim.expiresUtc -le [DateTime]::UtcNow){throw "Batch '$BatchId' has no active claim for '$Agent'."}
$commands=@{
 CoreFmt=@{Dir=(Join-Path $root 'tastile-core');Exe='cargo';Args=@('fmt','--all','--','--check')}
 CoreClippy=@{Dir=(Join-Path $root 'tastile-core');Exe='cargo';Args=@('clippy','--workspace','--all-targets','--','-D','warnings')}
 CoreTests=@{Dir=(Join-Path $root 'tastile-core');Exe='cargo';Args=@('test','--workspace')}
 WebCheck=@{Dir=(Join-Path $root 'tastile-web');Exe='bun';Args=@('run','check')}
 WebBuild=@{Dir=(Join-Path $root 'tastile-web');Exe='bun';Args=@('run','build')}
 AndroidUnit=@{Dir=(Join-Path $root 'tastile-android');Exe='.\\gradlew';Args=@('test')}
}
$selected=$commands[$ApprovedCommand]; if(-not(Test-Path -LiteralPath $selected.Dir)){throw "Working directory is missing: $($selected.Dir)"}
Push-Location $selected.Dir; try { & $selected.Exe @($selected.Args); $ok=$?; $code=$LASTEXITCODE } finally { Pop-Location }
if(-not $ok -or $code -ne 0){throw "Approved command '$ApprovedCommand' failed (exit $code)."}
$sha=(git -C $root rev-parse HEAD).Trim();$utc=[DateTime]::UtcNow.ToString('o')
"STATUS.md append candidate (review before writing):`n| $BatchId | $Specification | Pending AT/UC mapping | $Agent | $($claim.fileGlob -join ', ') | recorded claim | $sha | approved command: $ApprovedCommand; utc: $utc; artifact: $EvidencePath | pending independent spec + quality review | attach PASS records to EVIDENCE.md |"
