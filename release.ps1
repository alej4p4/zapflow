# PowerShell script to build and release Docker image for ZapFlow

# Load version from package.json
$packageJsonPath = Join-Path -Path $PSScriptRoot -ChildPath 'package.json'
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$version = $packageJson.version

Write-Host "Building Docker image for version $version..."

# Build Docker image
docker build -t zapflow:$version .
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed."
    exit 1
}

# Tag as latest
docker tag zapflow:$version zapflow:latest

# Push both tags to Docker Hub (replace with your repository name if needed)
# Ensure you are logged in: docker login

docker push zapflow:$version
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to push version tag."; exit 1 }

docker push zapflow:latest
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to push latest tag."; exit 1 }

Write-Host "Docker image $version released successfully."
