#ifndef AppDir
  #error AppDir must point to the packaged Electron directory
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef AppArch
  #error AppArch must be x64 or arm64
#endif

#if AppArch == "arm64"
  #define AllowedArchitectures "arm64"
#else
  #define AllowedArchitectures "x64compatible"
#endif

[Setup]
AppId={{9D324B3C-0F11-46E4-A001-7C7A2D8D7A51}
AppName=AI Balance Whale
AppVersion={#AppVersion}
AppPublisher=404404
DefaultDirName={localappdata}\Programs\AI Balance Whale
DefaultGroupName=AI Balance Whale
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed={#AllowedArchitectures}
ArchitecturesInstallIn64BitMode={#AllowedArchitectures}
OutputDir={#OutputDir}
OutputBaseFilename=AI-Balance-Whale-windows-{#AppArch}-v{#AppVersion}-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\AI Balance Whale.exe
CloseApplications=yes
RestartApplications=no

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\AI Balance Whale"; Filename: "{app}\AI Balance Whale.exe"
Name: "{autodesktop}\AI Balance Whale"; Filename: "{app}\AI Balance Whale.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："; Flags: unchecked

[Run]
Filename: "{app}\AI Balance Whale.exe"; Description: "启动 AI Balance Whale"; Flags: nowait postinstall skipifsilent
