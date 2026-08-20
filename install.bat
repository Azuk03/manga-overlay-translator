@echo off
chcp 65001 >nul
rem Cai vao thu muc khac: install.bat -InstallDir D:\MangaTranslator
echo Dang tai trinh cai dat Manga Translator...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/bootstrap.ps1' -OutFile \"$env:TEMP\mot-bootstrap.ps1\"; & \"$env:TEMP\mot-bootstrap.ps1\" %*"
pause
