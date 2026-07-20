function Test-DockerReady {
    try {
        docker version *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-NvidiaGpu {
    try {
        nvidia-smi *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-DockerImageExists {
    param([string]$ImageName)
    try {
        docker image inspect $ImageName *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-ApiKeyFormat {
    param([string]$Key)
    if ([string]::IsNullOrWhiteSpace($Key)) { return $false }
    return $Key.Trim().StartsWith("sk-")
}

function Build-DockerRunArgs {
    param(
        [hashtable]$EnvVars,
        [bool]$HasGpu,
        [string]$ContainerName,
        [string]$ResultDir
    )

    $dockerArgs = @(
        "run", "--rm",
        "--name", $ContainerName,
        "-p", "5003:5003",
        "-p", "8000:8000",
        "-p", "8001:8001",
        "--ipc=host"
    )

    if ($HasGpu) {
        $dockerArgs += @("--gpus", "all")
    }

    $dockerArgs += @(
        "--entrypoint", "python",
        "-v", "$($ResultDir):/app/result",
        "-e", "OPENAI_API_KEY=$($EnvVars['OPENAI_API_KEY'])"
    )

    if ($EnvVars.ContainsKey("OPENAI_MODEL")) {
        $dockerArgs += @("-e", "OPENAI_MODEL=$($EnvVars['OPENAI_MODEL'])")
    }
    if ($EnvVars.ContainsKey("OPENAI_API_BASE")) {
        $dockerArgs += @("-e", "OPENAI_API_BASE=$($EnvVars['OPENAI_API_BASE'])")
    }

    $dockerArgs += @(
        "manga-translator-patched:local",
        "server/main.py", "--start-instance", "--host=0.0.0.0", "--port=5003"
    )

    if ($HasGpu) {
        $dockerArgs += "--use-gpu"
    }

    $dockerArgs += @("--models-ttl", "0", "--nonce", "None")

    return $dockerArgs
}
