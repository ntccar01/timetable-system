@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ====================================================
echo   課表系統一鍵更新至 GitHub Pages
echo ====================================================
echo.

git status --short
echo.

for /f %%i in ('git status --porcelain') do set HAS_CHANGES=1
if not defined HAS_CHANGES (
  echo 目前沒有偵測到任何檔案變更，無需上傳。
  echo 線上網址：https://ntccar01.github.io/timetable-system/
  pause
  exit /b 0
)

echo [注意] .gitignore 已自動排除 .pdf / .doc / .docx 等原始檔案。
echo 請確認上方列出的變更檔案皆已去個資。
echo.
set /p COMMIT_MSG="請輸入本次更新說明（直接按 Enter 預設為「更新課表與網站內容」）: "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=更新課表與網站內容

echo.
echo [1/3] 加入變更檔案...
git add .

echo [2/3] 建立版本紀錄...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo 建立版本紀錄失敗，請檢查上方訊息。
  pause
  exit /b 1
)

echo [3/3] 推送至 GitHub...
git push origin main
if errorlevel 1 (
  echo 推送失敗，請檢查網路連線或 GitHub 登入狀態。
  pause
  exit /b 1
)

echo.
echo ====================================================
echo   更新成功！約 1～2 分鐘後線上網站就會同步完成：
echo   https://ntccar01.github.io/timetable-system/
echo ====================================================
pause
