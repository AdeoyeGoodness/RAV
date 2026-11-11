Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "RavMonitor.exe"" --screenshot-helper --interval 60", 0, False
