param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$expected = 'b1f64a122dbd2d3d3010bffe3ef38dd56760d5896be44bdf5e416dcff0902153'
if ((Get-FileHash -Algorithm SHA256 $SourcePath).Hash.ToLowerInvariant() -ne $expected) {
    throw 'The AMD GPU Cloud source logo does not match the verified asset.'
}
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile($SourcePath)
$canvas = New-Object Drawing.Bitmap 256,256
$graphics = [Drawing.Graphics]::FromImage($canvas)
try {
    $graphics.Clear([Drawing.Color]::White)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $width = 196
    $height = [int][Math]::Round($width * $source.Height / $source.Width)
    $graphics.DrawImage($source, [int]30, [int]((256-$height)/2), [int]$width, [int]$height)
    $canvas.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $canvas.Dispose()
    $source.Dispose()
}
Write-Output 'Verified AMD GPU Cloud page logo packaged locally; no remote icon dependency.'