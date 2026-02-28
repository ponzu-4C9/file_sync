@echo off
REM start-sync.bat
node client/dist/index.js -s ws://192.168.3.50:49522 -d "C:\Users\baiji\OneDrive\ドキュメント\Arduino" -u admin -p changeme
pause 