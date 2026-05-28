Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "AssetTelemetry.exe"" --screenshot-helper --interval 60", 0, False
