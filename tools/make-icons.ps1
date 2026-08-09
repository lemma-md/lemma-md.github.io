# Rasterises favicon.svg to PNG using GDI+, so the SVG stays the only place
# the mark is defined. Handles just the subset of SVG that favicon.svg uses:
# one <rect> and absolute-coordinate <path> data (M, L, C, H, V, Z).
#
# This is not part of a build — the app serves favicon.svg and the PNGs as they
# are. It exists so the PNGs can be regenerated after the SVG changes, instead
# of being redrawn by hand and drifting away from it.
#
#   .\tools\make-icons.ps1 favicon.svg favicon-16.png 16
#   .\tools\make-icons.ps1 favicon.svg favicon-32.png 32
#   .\tools\make-icons.ps1 favicon.svg logo-120.png 120
#   .\tools\make-icons.ps1 favicon.svg apple-touch-icon.png 180 -FullBleed
param(
  [string]$SvgPath,
  [string]$OutPath,
  [int]$Size,
  [switch]$FullBleed   # fill the whole square with the tile colour: iOS applies
)                      # its own mask, so transparent rounded corners go black

Add-Type -AssemblyName System.Drawing

$svg = Get-Content -Raw $SvgPath

if ($svg -notmatch 'viewBox\s*=\s*"([\d\.\s\-]+)"') { throw "no viewBox" }
$vb = $matches[1].Trim() -split '\s+'
$scale = $Size / [double]$vb[2]

function Get-Attr([string]$tag, [string]$name) {
  if ($tag -match "$name\s*=\s*`"([^`"]*)`"") { return $matches[1] }
  return $null
}
function Get-Colour([string]$s) {
  $h = $s.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(255,
    [Convert]::ToInt32($h.Substring(0,2),16),
    [Convert]::ToInt32($h.Substring(2,2),16),
    [Convert]::ToInt32($h.Substring(4,2),16))
}

# --- build the bitmap -------------------------------------------------------

$bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# --- the tile ---------------------------------------------------------------

if ($svg -notmatch '<rect\b[^>]*>') { throw "no <rect>" }
$rectTag = $matches[0]
$rw = [double](Get-Attr $rectTag 'width') * $scale
$rh = [double](Get-Attr $rectTag 'height') * $scale
$rx = [double](Get-Attr $rectTag 'rx') * $scale
$fill = Get-Colour (Get-Attr $rectTag 'fill')
$brush = New-Object System.Drawing.SolidBrush($fill)

if ($FullBleed) {
  $g.FillRectangle($brush, 0, 0, $Size, $Size)
} else {
  $d = $rx * 2
  $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tile.AddArc(0, 0, $d, $d, 180, 90)
  $tile.AddArc($rw - $d, 0, $d, $d, 270, 90)
  $tile.AddArc($rw - $d, $rh - $d, $d, $d, 0, 90)
  $tile.AddArc(0, $rh - $d, $d, $d, 90, 90)
  $tile.CloseFigure()
  $g.FillPath($brush, $tile)
  $tile.Dispose()
}

# --- the strokes ------------------------------------------------------------

foreach ($m in [regex]::Matches($svg, '<path\b[^>]*>')) {
  $tag = $m.Value
  $dAttr = Get-Attr $tag 'd'
  $stroke = Get-Attr $tag 'stroke'
  $width = [double](Get-Attr $tag 'stroke-width') * $scale

  $pen = New-Object System.Drawing.Pen((Get-Colour $stroke), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  # Split "M34 20 C34 14 26 13..." into one entry per command letter.
  $cmds = [regex]::Matches($dAttr, '([MLCHVZmlchvz])([^MLCHVZmlchvz]*)')
  $cx = 0.0; $cy = 0.0; $started = $false
  foreach ($c in $cmds) {
    $letter = $c.Groups[1].Value
    $nums = @()
    foreach ($t in ($c.Groups[2].Value.Trim() -split '[\s,]+')) {
      if ($t -ne '') { $nums += [double]$t * $scale }
    }
    switch ($letter) {
      'M' { if ($started) { $path.StartFigure() }; $cx = $nums[0]; $cy = $nums[1]; $started = $true }
      'L' { $path.AddLine($cx, $cy, $nums[0], $nums[1]); $cx = $nums[0]; $cy = $nums[1] }
      'H' { $path.AddLine($cx, $cy, $nums[0], $cy); $cx = $nums[0] }
      'V' { $path.AddLine($cx, $cy, $cx, $nums[0]); $cy = $nums[0] }
      'C' { $path.AddBezier($cx, $cy, $nums[0], $nums[1], $nums[2], $nums[3], $nums[4], $nums[5]); $cx = $nums[4]; $cy = $nums[5] }
      'Z' { $path.CloseFigure() }
      default { throw "unsupported path command '$letter'" }
    }
  }
  $g.DrawPath($pen, $path)
  $path.Dispose(); $pen.Dispose()
}

$g.Dispose()
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$info = Get-Item $OutPath
"wrote $($info.Name): ${Size}x${Size}, $($info.Length) bytes"
