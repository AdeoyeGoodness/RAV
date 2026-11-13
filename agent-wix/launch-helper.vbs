Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "RavMonitor.exe"" --screenshot-helper --interval 30", 0, False
