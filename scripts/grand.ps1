# Araignée de Claude : ouvre la toile en grand, calée sur la zone de discussion de Claude
# (à droite de la barre des discussions), et la garde alignée tant qu'elle est ouverte.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Title,
  [int]$Left = 300,
  [int]$Top = 44,
  [int]$Bottom = 0,
  [string]$Root = ''
)
$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AraigneeWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static IntPtr Find(string part) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => { if (IsWindowVisible(h) && Text(h).Contains(part)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
[void][AraigneeWin]::SetProcessDPIAware()

function ProcName([IntPtr]$h) {
  $procId = [uint32]0
  [void][AraigneeWin]::GetWindowThreadProcessId($h, [ref]$procId)
  try { (Get-Process -Id $procId).ProcessName } catch { '' }
}

# la fenêtre de Claude : celle qui est au premier plan quand on clique sur « Agrandir »
$claude = [AraigneeWin]::GetForegroundWindow()
if ((ProcName $claude) -notmatch '^claude$') {
  $p = Get-Process -Name claude | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 1
  if ($p) { $claude = $p.MainWindowHandle }
}
if (-not [AraigneeWin]::IsWindow($claude)) { Write-Output 'claude-introuvable'; exit 1 }

# une seule grande toile à la fois
$old = [AraigneeWin]::Find($Title)
if ($old -ne [IntPtr]::Zero) { [void][AraigneeWin]::ShowWindow($old, 5); exit 0 }

Start-Process -FilePath 'msedge' -ArgumentList @("--app=$Url", '--no-first-run', '--disable-features=msEdgeSidebarV2')
$win = [IntPtr]::Zero
for ($i = 0; $i -lt 60 -and $win -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $win = [AraigneeWin]::Find($Title) }
if ($win -eq [IntPtr]::Zero) { Write-Output 'fenetre-introuvable'; exit 1 }

# sans barre de titre ni bordure : la toile se fond dans Claude
$GWL_STYLE = -16
$style = [AraigneeWin]::GetWindowLong($win, $GWL_STYLE)
[void][AraigneeWin]::SetWindowLong($win, $GWL_STYLE, ($style -band (-bnot 0x00CF0000)))

$TOPMOST = [IntPtr](-1)
$SWP_NOACTIVATE = 0x0010; $SWP_FRAMECHANGED = 0x0020; $SWP_SHOWWINDOW = 0x0040
$last = ''
$hidden = $false
$opened = ''
# un clic sur un cocon : la page met « #open:<n>:<chemin> » dans son titre, on ouvre le fichier avec son application
function OpenRequest([string]$title) {
  if ($title -notmatch '#open:(\d+):(.+)$') { return }
  $n = $Matches[1]; $rel = $Matches[2]
  if ($n -eq $script:opened -or -not $Root) { return }
  $script:opened = $n
  if ($rel -match '\.\.' ) { return }
  $full = [System.IO.Path]::GetFullPath((Join-Path $Root ($rel -replace '/', '\')))
  if (-not $full.StartsWith([System.IO.Path]::GetFullPath($Root), [System.StringComparison]::OrdinalIgnoreCase)) { return }
  if (Test-Path -LiteralPath $full -PathType Leaf) { Invoke-Item -LiteralPath $full }
}
while ([AraigneeWin]::IsWindow($win)) {
  if (-not [AraigneeWin]::IsWindow($claude)) { break }
  OpenRequest ([AraigneeWin]::Text($win))
  # la toile ne se montre que quand Claude (ou elle-même) est au premier plan
  $fg = [AraigneeWin]::GetForegroundWindow()
  $show = (-not [AraigneeWin]::IsIconic($claude)) -and ($fg -eq $claude -or $fg -eq $win)
  if (-not $show) {
    if (-not $hidden) { [void][AraigneeWin]::ShowWindow($win, 0); $hidden = $true; $last = '' }
    Start-Sleep -Milliseconds 200; continue
  }
  $r = New-Object AraigneeWin+RECT
  [void][AraigneeWin]::GetWindowRect($claude, [ref]$r)
  $dpi = [AraigneeWin]::GetDpiForWindow($claude); if (-not $dpi) { $dpi = 96 }
  $s = $dpi / 96.0
  $x = $r.L + [int]($Left * $s); $y = $r.T + [int]($Top * $s)
  $w = $r.R - $x; $h = $r.B - [int]($Bottom * $s) - $y
  $key = "$x,$y,$w,$h"
  if (($key -ne $last -or $hidden) -and $w -gt 50 -and $h -gt 50) {
    [void][AraigneeWin]::SetWindowPos($win, $TOPMOST, $x, $y, $w, $h, $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)
    $last = $key; $hidden = $false
  }
  Start-Sleep -Milliseconds 150
}
if ([AraigneeWin]::IsWindow($win)) { [void][AraigneeWin]::ShowWindow($win, 0) }
