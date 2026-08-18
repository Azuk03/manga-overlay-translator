$script:SecretPattern = 'KEY|TOKEN|AUTH|SECRET'

function Build-DockerRunArgs {
    param([hashtable]$EnvVars, [bool]$HasGpu, [string]$ContainerName, [string]$ResultDir)

    $a = @('run', '--rm', '--name', $ContainerName,
           '-p', '5003:5003', '-p', '8000:8000', '-p', '8001:8001', '--ipc=host')
    if ($HasGpu) { $a += @('--gpus', 'all') }
    # KHÔNG mount fonts/ - mount thư mục rỗng sẽ đè lên font có sẵn trong image.
    $a += @('--entrypoint', 'python', '-v', "$($ResultDir):/app/result")

    foreach ($k in @('OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_API_BASE', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'DEEPL_AUTH_KEY')) {
        if ($EnvVars.ContainsKey($k) -and $EnvVars[$k]) { $a += @('-e', "$k=$($EnvVars[$k])") }
    }

    $a += @('manga-translator-patched:local',
            'server/main.py', '--start-instance', '--host=0.0.0.0', '--port=5003')
    if ($HasGpu) { $a += '--use-gpu' }
    $a += @('--models-ttl', '0', '--nonce', 'None')
    return $a
}

function Hide-Secrets {
    param([string[]]$Arguments)
    $result = @()
    foreach ($arg in $Arguments) {
        $idx = $arg.IndexOf('=')
        if ($idx -gt 0) {
            $name = $arg.Substring(0, $idx)
            if ($name -match $script:SecretPattern) {
                $result += @("$name=***")
            } else {
                $result += @($arg)
            }
        } else {
            $result += @($arg)
        }
    }
    return @($result)
}

function Stop-Backend {
    param([string]$ContainerName)
    docker stop $ContainerName 2>$null | Out-Null
}

function Start-Backend {
    param([string[]]$DockerArgs)
    docker @DockerArgs
}
