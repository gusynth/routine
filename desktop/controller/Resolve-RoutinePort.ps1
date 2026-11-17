param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$verified = @()
try {
    $listeners = @([RoutinePorts]::Listeners(3000))
    if (-not $listeners.Count) { return [pscustomobject]@{ Status='cleared'; Message='Porta livre.' } }
    $expected = [IO.Path]::GetFullPath((Join-Path $Root 'server.js'))
    # Identify every listener before stopping any of them.
    $verified = @()
    foreach ($ownerId in $listeners) {
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction Stop
        $process = [Diagnostics.Process]::GetProcessById($ownerId)
        $null = $process.Handle
        if ($process.ProcessName -ne 'node' -or -not $candidate.CommandLine) {
            $process.Dispose()
            return [pscustomobject]@{ Status='occupied'; Message="A porta 3000 pertence a $($candidate.Name). O launcher nao encerrou esse programa. Feche-o e clique em Resolver e iniciar novamente." }
        }
        $directory = [RoutineProcessInfo]::Directory($ownerId)
        $scriptFile = [RoutineProcessInfo]::ScriptPath($candidate.CommandLine,$directory)
        if (-not [string]::Equals($scriptFile,$expected,[StringComparison]::OrdinalIgnoreCase)) {
            $process.Dispose(); return [pscustomobject]@{Status='occupied';Message='A porta pertence a um servidor de outra pasta. Ele foi preservado. Feche esse servidor e tente novamente.'}
        }
        # PID reuse protection: the CIM snapshot and the open process must agree.
        if ([Math]::Abs(($process.StartTime.ToUniversalTime()-$candidate.CreationDate.ToUniversalTime()).TotalSeconds) -gt 1) {
            $process.Dispose(); throw 'O processo mudou durante a verificacao. Clique em Resolver e iniciar novamente.'
        }
        $verified += $process
    }
    foreach ($process in $verified) {
        if (-not $process.HasExited) { $process.Kill(); if (-not $process.WaitForExit(4000)) { throw 'O servidor antigo nao encerrou a tempo. Tente novamente.' } }
    }
    [pscustomobject]@{Status='cleared';Message='Servidor antigo desta pasta encerrado. Iniciando a versao atual.'}
} catch {
    [pscustomobject]@{Status='error';Message=('Nao foi possivel identificar o servidor com seguranca. '+$_.Exception.Message)}
} finally {
    foreach ($process in $verified) { $process.Dispose() }
}
