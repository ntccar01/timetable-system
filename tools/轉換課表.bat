@echo off
chcp 65001 > nul
echo ====================================================
echo   課表 PDF 本機去個資轉檔工具
echo   (所有處理皆在本機電腦完成，不會上傳任何個資)
echo ====================================================
echo.
set /p TERM_ID="請輸入學年度學期代碼 (例如 115-2): "
set /p TERM_LABEL="請輸入顯示名稱 (例如 115 學年度第 2 學期): "
set /p TEACHER_PDF="請拖曳「教師課表.pdf」到此視窗後按 Enter: "
set /p CLASS_PDF="請拖曳「班級課表.pdf」到此視窗後按 Enter: "

set TEACHER_PDF=%TEACHER_PDF:"=%
set CLASS_PDF=%CLASS_PDF:"=%

python "%~dp0convert_pdf_to_json.py" ^
  --teacher-pdf "%TEACHER_PDF%" ^
  --class-pdf "%CLASS_PDF%" ^
  --term-id "%TERM_ID%" ^
  --term-label "%TERM_LABEL%" ^
  --out-json "%~dp0..\data\%TERM_ID%.json"

echo.
echo 轉檔完成！請打開網頁系統，點選右上角「匯入新學年度課表」選擇 data\%TERM_ID%.json 即可。
pause
