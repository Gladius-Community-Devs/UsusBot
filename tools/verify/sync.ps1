<#
.SYNOPSIS
    Refresh the local game-data snapshot used by tools/verify.

.DESCRIPTION
    Copies only what the bot reads - data/config, data/towns and data/units for
    each mod - plus the shared modders list. The destination is .verify/, which
    is git-ignored: this is game content and must never be committed.

    The server is the source of truth. Run this before a sweep if the mods have
    changed; the bot on the server reads the same files.

.EXAMPLE
    pwsh tools/verify/sync.ps1
    pwsh tools/verify/sync.ps1 -Mods Vanilla,Ragnarok
#>
param(
    [string]$Server = 'aihelper@192.168.1.9',
    [string]$RemoteRoot = '/var/www/gladius-data',
    [string[]]$Mods = @('Vanilla', 'VanillaPlus', 'LeoMod', 'Ragnarok')
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dest = Join-Path $repo '.verify'
$archive = Join-Path $dest 'usus-verify.tgz'
$remoteArchive = '/tmp/usus-verify.tgz'

New-Item -ItemType Directory -Force -Path $dest | Out-Null

$paths = foreach ($mod in $Mods) {
    "$mod/data/config"
    "$mod/data/towns"
    "$mod/data/units"
}

Write-Host "Archiving $($Mods -join ', ') on $Server ..."
ssh $Server "cd $RemoteRoot && tar -czf $remoteArchive $($paths -join ' ')"

Write-Host 'Copying archive ...'
scp "$Server`:$remoteArchive" $archive

Write-Host 'Extracting ...'
tar -xzf $archive -C $dest
Remove-Item $archive

Write-Host 'Copying modders list ...'
scp "$Server`:/var/www/gladiuscommunity/config/allowed_modders.json" (Join-Path $dest 'modders.json')

$files = (Get-ChildItem (Join-Path $dest $Mods[0]) -Recurse -File).Count
Write-Host "Done. $($Mods.Count) mod(s) under $dest ($files files in $($Mods[0]))."
