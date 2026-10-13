#ifndef AppDir
  #error AppDir must point to the packaged Electron directory
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef AppArch
  #error AppArch must be ia32, x64 or arm64
#endif

#if AppArch == "arm64"
  #define AllowedArchitectures "arm64"
#elif AppArch == "ia32"
  #define AllowedArchitectures "x86compatible"
#else
  #define AllowedArchitectures "x64compatible"
#endif

[Setup]
AppId={{9D324B3C-0F11-46E4-A001-7C7A2D8D7A51}
AppName=desktop-demo
AppVersion={#AppVersion}
AppPublisher=404404
DefaultDirName={localappdata}\Programs\desktop-demo
DefaultGroupName=desktop-demo
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
#if AppArch == "ia32"
ArchitecturesAllowed=x86compatible
#else
ArchitecturesAllowed={#AllowedArchitectures}
ArchitecturesInstallIn64BitMode={#AllowedArchitectures}
#endif
OutputDir={#OutputDir}
OutputBaseFilename=desktop-demo-windows-{#AppArch}-v{#AppVersion}-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\desktop-demo.exe
CloseApplications=yes
RestartApplications=no

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\desktop-demo"; Filename: "{app}\desktop-demo.exe"
Name: "{autodesktop}\desktop-demo"; Filename: "{app}\desktop-demo.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："; Flags: unchecked

[Run]
Filename: "{app}\desktop-demo.exe"; Description: "启动 desktop-demo"; Flags: nowait postinstall skipifsilent
