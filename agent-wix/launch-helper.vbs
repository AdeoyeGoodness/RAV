Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "rav-agent.exe"" --screenshot-helper --interval 60", 0, False
