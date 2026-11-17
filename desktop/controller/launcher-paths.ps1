function Get-RoutineDataRoot([string]$Root) {
    $marker = Join-Path $Root 'routine.install.json'
    $installed = Test-Path -LiteralPath $marker
    if ($installed) {
        $layout = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
        if ($layout.appId -ne 'Routine' -or $layout.layoutVersion -ne 1) { throw 'Layout de instalacao Routine invalido.' }
    }
    if ($env:ROUTINE_DATA_DIR) { return [IO.Path]::GetFullPath($env:ROUTINE_DATA_DIR) }
    if (-not $env:LOCALAPPDATA) { throw 'Pasta de dados do usuario indisponivel.' }
    return Join-Path $env:LOCALAPPDATA 'Routine'
}
function Get-RoutineNodePath([string]$Root) {
    $bundled = Join-Path $Root 'runtime\node\node.exe'
    if (Test-Path -LiteralPath $bundled) { return $bundled }
    if (Test-Path -LiteralPath (Join-Path $Root 'routine.install.json')) { throw 'Runtime do Routine ausente. Reinstale os arquivos do programa; seus registros ficam separados.' }
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Node.js nao encontrado. Instale Node.js 22 ou superior.' }
    return $command.Source
}
