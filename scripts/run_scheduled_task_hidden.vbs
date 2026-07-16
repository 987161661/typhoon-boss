Option Explicit

If WScript.Arguments.Count <> 1 Then
  WScript.Quit 2
End If

Dim shell, scriptPath, command, exitCode
Set shell = CreateObject("WScript.Shell")
scriptPath = WScript.Arguments(0)
command = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(scriptPath)
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
