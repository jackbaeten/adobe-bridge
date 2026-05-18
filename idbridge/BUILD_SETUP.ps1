# Adobe Bridge - One-Click Builder
# Right-click -> Run with PowerShell

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Adobe Bridge - Setup Builder"

function Write-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor DarkGray
    Write-Host "   Adobe Bridge  v1.0  -  Setup Builder" -ForegroundColor White
    Write-Host "  ============================================" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Step($text) {
    Write-Host "  >> " -ForegroundColor Cyan -NoNewline
    Write-Host $text -ForegroundColor White
}

function Write-OK($text) {
    Write-Host "  OK " -ForegroundColor Green -NoNewline
    Write-Host $text -ForegroundColor Gray
}

function Write-Fail($text) {
    Write-Host ""
    Write-Host "  ERROR: $text" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Header

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# ── Step 1: Check Node.js ─────────────────────────────────────
Write-Step "Checking Node.js..."

$nodeVer = ""
try { $nodeVer = & node --version 2>$null } catch {}

if ($nodeVer -match "v\d+") {
    Write-OK "Node.js $nodeVer"
} else {
    Write-Step "Node.js not found - downloading..."
    $nodeUrl = "https://nodejs.org/dist/v20.14.0/node-v20.14.0-x64.msi"
    $nodeMsi = "$env:TEMP\node-installer.msi"
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        Write-Step "Installing Node.js..."
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /quiet /norestart" -Wait
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeVer = & node --version 2>$null
        Write-OK "Node.js $nodeVer installed"
    } catch {
        Write-Fail "Could not install Node.js automatically. Install from https://nodejs.org then run this script again."
    }
}

# ── Step 2: npm install ───────────────────────────────────────
Write-Host ""
Write-Step "Installing packages (first time ~80MB download)..."

# Run npm install - ignore warnings, only fail on real errors
$proc = Start-Process "npm" -ArgumentList "install" -WorkingDirectory $scriptDir -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
    Write-Fail "npm install failed with exit code $($proc.ExitCode)"
}
Write-OK "Packages installed"

# ── Step 3: Build Electron app ────────────────────────────────
Write-Host ""
Write-Step "Building app (packaging with Electron)..."

$proc2 = Start-Process "npm" -ArgumentList "run build" -WorkingDirectory $scriptDir -Wait -PassThru -NoNewWindow
if ($proc2.ExitCode -ne 0) {
    Write-Fail "Build failed. Check output above."
}
Write-OK "App built to dist\win-unpacked\"

# ── Step 4: Check / install NSIS ─────────────────────────────
Write-Host ""
Write-Step "Checking NSIS..."

$nsisPath = $null
foreach ($p in @(
    "C:\Program Files (x86)\NSIS\makensis.exe",
    "C:\Program Files\NSIS\makensis.exe",
    "C:\NSIS\makensis.exe"
)) {
    if (Test-Path $p) { $nsisPath = $p; break }
}

if (-not $nsisPath) {
    Write-Step "NSIS not found - downloading silently..."
    $nsisUrl = "https://downloads.sourceforge.net/project/nsis/NSIS%203/3.10/nsis-3.10-setup.exe"
    $nsisExe = "$env:TEMP\nsis-setup.exe"
    try {
        Invoke-WebRequest -Uri $nsisUrl -OutFile $nsisExe -UseBasicParsing
        Start-Process $nsisExe -ArgumentList "/S" -Wait
        Start-Sleep -Seconds 3
        foreach ($p in @(
            "C:\Program Files (x86)\NSIS\makensis.exe",
            "C:\Program Files\NSIS\makensis.exe"
        )) {
            if (Test-Path $p) { $nsisPath = $p; break }
        }
        if ($nsisPath) { Write-OK "NSIS installed" }
        else { Write-Fail "NSIS installed but not found. Please restart this script." }
    } catch {
        Write-Fail "Could not install NSIS. Download from https://nsis.sourceforge.io/Download install it, then run this script again."
    }
} else {
    Write-OK "NSIS found"
}

# ── Step 5: Build installer ───────────────────────────────────
Write-Host ""
Write-Step "Building Setup.exe..."

$nsiFile = Join-Path $scriptDir "installer\installer.nsi"
$proc3 = Start-Process $nsisPath -ArgumentList "/V2 `"$nsiFile`"" -WorkingDirectory $scriptDir -Wait -PassThru -NoNewWindow
if ($proc3.ExitCode -ne 0) {
    Write-Fail "NSIS failed. Check that dist\win-unpacked\ exists."
}

# Move installer to dist
if (Test-Path "Adobe Bridge Setup.exe") {
    if (-not (Test-Path "dist")) { New-Item -ItemType Directory "dist" | Out-Null }
    Move-Item "Adobe Bridge Setup.exe" "dist\Adobe Bridge Setup.exe" -Force
}

$setupPath = Join-Path $scriptDir "dist\Adobe Bridge Setup.exe"
if (Test-Path $setupPath) {
    $size = [math]::Round((Get-Item $setupPath).Length / 1MB, 1)
    Write-OK "Setup.exe created ($size MB)"
} else {
    Write-Fail "Setup.exe not found after build."
}

# ── Done ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host "   Done! Your installer is ready." -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  $setupPath" -ForegroundColor Cyan
Write-Host ""

$open = Read-Host "  Open the dist folder? (Y/n)"
if ($open -ne "n" -and $open -ne "N") {
    Start-Process explorer.exe -ArgumentList (Join-Path $scriptDir "dist")
}

Write-Host ""
Write-Host "  Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
