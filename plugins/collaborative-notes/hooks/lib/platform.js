// The few things the plugin asks of the operating system, as argv for
// $.process: macOS commands as before; Windows scripts are constant per
// operation and take every path/URL value from the process environment.
const command = (script, values = []) => ({
  argv: ["powershell", "-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; ${script}`],
  ...(values.length ? { env: Object.fromEntries(values.map((value, index) => [`CN_ARG${index + 1}`, String(value)])) } : {}),
});

export const normalizePath = (path, windows = /^[A-Za-z]:[\\/]/.test(String(path))) =>
  windows ? String(path).replace(/\\/g, "/") : String(path);
export const isAbsolutePath = (path) => {
  const value = normalizePath(path);
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
};

export function removeFile(path, windows) {
  return windows
    ? command("if (Test-Path -LiteralPath $env:CN_ARG1) { Remove-Item -LiteralPath $env:CN_ARG1 -Force }", [path])
    : { argv: ["rm", "-f", path] };
}

export function makeDirs(path, windows) {
  return windows
    ? command("[void][IO.Directory]::CreateDirectory($env:CN_ARG1)", [path])
    : { argv: ["mkdir", "-p", path] };
}

export function makeDir(path, windows) {
  return windows
    ? command("if ([IO.Directory]::Exists($env:CN_ARG1) -or [IO.File]::Exists($env:CN_ARG1)) { throw 'Directory already exists' }; [void][IO.Directory]::CreateDirectory($env:CN_ARG1)", [path])
    : { argv: ["mkdir", path] };
}

export function moveFile(from, to, windows) {
  return windows
    ? command("[void](Move-Item -LiteralPath $env:CN_ARG1 -Destination $env:CN_ARG2 -Force)", [from, to])
    : { argv: ["mv", "-f", from, to] };
}

export function readFrom(path, offset, windows) {
  return windows
    ? command(`$bytes = [IO.File]::ReadAllBytes($env:CN_ARG1); $start = [Math]::Min([long]${Math.max(0, Math.trunc(offset))}, $bytes.LongLength); [Console]::OpenStandardOutput().Write($bytes, [int]$start, [int]($bytes.LongLength - $start))`, [path])
    : { argv: ["tail", "-c", `+${offset + 1}`, path] };
}

export function readAll(path, windows) {
  return windows
    ? command("[Console]::Out.Write([IO.File]::ReadAllText($env:CN_ARG1, [Text.Encoding]::UTF8))", [path])
    : { argv: ["cat", path] };
}

export function clipboard(windows) {
  return windows
    ? command(`$text = Get-Clipboard -Raw; if ($null -ne $text) { [Console]::Out.Write([string]$text) }`)
    : { argv: ["pbpaste"], env: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" } };
}

export function openLink(url, windows) {
  return windows
    ? command("Start-Process -FilePath $env:CN_ARG1", [url])
    : { argv: ["open", url] };
}

export function tempFile(name, windows) {
  return windows
    ? command("$path = Join-Path ([IO.Path]::GetTempPath()) ($env:CN_ARG1 + '-' + [Guid]::NewGuid().ToString('N') + '.tmp'); [IO.File]::Create($path).Dispose(); [Console]::Out.Write($path)", [name])
    : { argv: ["mktemp", "-t", name] };
}

export function openInEditor(path, windows) {
  return windows
    ? command(`Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $env:CN_ARG1 + '"')`, [path])
    : { argv: ["open", "-t", path] };
}

export function systemLanguage(windows) {
  return windows
    ? command(`$language = Get-WinUserLanguageList | Select-Object -First 1; if ($null -ne $language) { [Console]::Out.Write($language.LanguageTag) }`)
    : { argv: ["defaults", "read", "-g", "AppleLanguages"] };
}

export const trimFolderPath = (path) => {
  const value = normalizePath(path);
  if (value === "/" || /^[A-Za-z]:\/$/.test(value)) return value;
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

export const childFolder = (path, name) => {
  const clean = trimFolderPath(path);
  const base = clean === "/" ? "" : /^[A-Za-z]:\/$/.test(clean) ? clean.slice(0, -1) : clean;
  return `${base}/${name}`;
};

export const parentFolder = (path) => {
  const clean = trimFolderPath(path) || "/";
  if (clean === "/" || /^[A-Za-z]:\/$/.test(clean)) return clean;
  const at = clean.lastIndexOf("/");
  if (/^[A-Za-z]:\//.test(clean) && at <= 2) return clean.slice(0, 3);
  return at <= 0 ? "/" : clean.slice(0, at);
};

export const isRootPath = (path) => {
  const clean = trimFolderPath(path);
  return clean === "/" || /^[A-Za-z]:\/$/.test(clean);
};

// The system folder dialog. macOS: osascript's own `choose folder` (no other
// app is scripted, so no automation permission); Windows: the standard
// FolderBrowserDialog. Title and start folder go as arguments / environment,
// never into script source. Prints the chosen path; prints nothing on cancel.
export const MAC_FOLDER_PICKER_SCRIPT = `on run argv
  set pickerTitle to item 1 of argv
  set initialPath to item 2 of argv
  tell me to activate
  try
    set chosen to choose folder with prompt pickerTitle default location (POSIX file initialPath)
  on error number n
    if n is -128 then error number -128
    set chosen to choose folder with prompt pickerTitle
  end try
  POSIX path of chosen
end run`;

export function pickFolder(title, initial, windows) {
  if (!windows) return { argv: ["/usr/bin/osascript", "-e", MAC_FOLDER_PICKER_SCRIPT, "--", String(title), String(initial || "/")] };
  const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; "
    + "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = $env:CN_ARG1; $d.ShowNewFolderButton = $true; "
    + "if ($env:CN_ARG2 -and [IO.Directory]::Exists($env:CN_ARG2)) { $d.SelectedPath = $env:CN_ARG2 }; "
    + "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }";
  return { argv: ["powershell", "-NoProfile", "-NonInteractive", "-STA", "-Command", script], env: { CN_ARG1: String(title), CN_ARG2: String(initial || "") } };
}

export const pickerCancelled = (stderr) => !String(stderr ?? "").trim() || /(?:\(-128\)|\b-128\b|user\s+cancell?ed)/i.test(String(stderr));
