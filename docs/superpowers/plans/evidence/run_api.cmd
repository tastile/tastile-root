@echo off
set TASTILE_DATABASE_URL=postgres://tastile:password@127.0.0.1:5432/tastile_db
set TASTILE_API_HOST=0.0.0.0
set TASTILE_API_PORT=31400
set RUST_LOG=info
set TASTILE_BYPASS_AUTH=1
cd /d "C:\Users\rebui\Desktop\tastile\tastile-core"
target\debug\api.exe 1>"C:\Users\rebui\Desktop\tastile\docs\superpowers\plans\evidence\api_run.log" 2>&1
