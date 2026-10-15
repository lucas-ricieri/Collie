Add-Type -AssemblyName System.Drawing
$collieImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath 'assets/collie-logo.jpg'))
$collieIconStream = [System.IO.MemoryStream]::new()
$collieWriter = [System.IO.BinaryWriter]::new($collieIconStream)
$collieSizes = @(16,32,48,64,128,256)
$colliePngs = @()
foreach ($collieSize in $collieSizes) {
  $collieBitmap = [System.Drawing.Bitmap]::new($collieSize,$collieSize)
  $collieGraphics = [System.Drawing.Graphics]::FromImage($collieBitmap)
  $collieGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $collieGraphics.DrawImage($collieImage,0,0,$collieSize,$collieSize)
  $colliePngStream = [System.IO.MemoryStream]::new()
  $collieBitmap.Save($colliePngStream,[System.Drawing.Imaging.ImageFormat]::Png)
  $colliePngs += ,$colliePngStream.ToArray()
  $collieGraphics.Dispose(); $collieBitmap.Dispose(); $colliePngStream.Dispose()
}
$collieWriter.Write([uint16]0); $collieWriter.Write([uint16]1); $collieWriter.Write([uint16]$collieSizes.Count)
$collieOffset = 6 + 16 * $collieSizes.Count
for ($collieIndex=0; $collieIndex -lt $collieSizes.Count; $collieIndex++) {
  $collieDimension = if ($collieSizes[$collieIndex] -eq 256) { 0 } else { $collieSizes[$collieIndex] }
  $collieWriter.Write([byte]$collieDimension); $collieWriter.Write([byte]$collieDimension); $collieWriter.Write([byte]0); $collieWriter.Write([byte]0)
  $collieWriter.Write([uint16]1); $collieWriter.Write([uint16]32); $collieWriter.Write([uint32]$colliePngs[$collieIndex].Length); $collieWriter.Write([uint32]$collieOffset)
  $collieOffset += $colliePngs[$collieIndex].Length
}
foreach ($colliePng in $colliePngs) { $collieWriter.Write([byte[]]$colliePng) }
[System.IO.File]::WriteAllBytes((Join-Path (Get-Location) 'assets/icon.ico'),$collieIconStream.ToArray())
$collieWriter.Dispose(); $collieIconStream.Dispose(); $collieImage.Dispose()
