# Run a Cocos Creator command-line build and wait only for the main editor process.
# (Start-Process -Wait would also wait for helper processes the editor leaves running.)
param(
    [Parameter(Mandatory = $true)][string]$Config,
    [int]$TimeoutMinutes = 60
)
$project = (Get-Location).Path
$cliArgs = @("--project", "`"$project`"", "--build", "`"configPath=$project\$Config`"")
$p = Start-Process -FilePath $env:CC_EXE -ArgumentList $cliArgs -PassThru -NoNewWindow
$null = $p.Handle  # keep a handle so ExitCode is available later
if (-not $p.WaitForExit($TimeoutMinutes * 60 * 1000)) {
    Write-Host "Editor did not exit within $TimeoutMinutes minutes"
}
if ($p.HasExited) { Write-Host "Editor exit code: $($p.ExitCode)" }
Get-Process CocosCreator -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
exit 0
