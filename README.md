# android-to-mac

在同一個 Wi-Fi 下，把 Android 上的照片、影片、文件傳到 Mac。不經過雲端。

```
server/   Mac 端接收 server（Node + TypeScript）
web/      上傳頁（原生 TypeScript + Vite），手機用瀏覽器開
```

## 使用方式（Mac 上）

```bash
npm install
npm run build
npm start
```

終端機會印出網址和 QR code，手機掃碼即可從瀏覽器上傳。手機和 Mac 要在同一個網路；若路由器開了 AP 隔離（兩台互相連不到），可以改用手機熱點讓 Mac 連上。檔案存到 `~/Downloads/FromAndroid`。

可用環境變數：`PORT`（預設 8765）、`SAVE_DIR`、`DEVICE_NAME`。

開發時：`npm run dev:server` 搭配 `npm run dev:web`（Vite 會把 `/api` 轉給 server）。

## 傳輸協定

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/info` | `{ name, version }`，網頁標題顯示 Mac 名稱用 |
| POST | `/api/upload` | Header `X-File-Name: encodeURIComponent(檔名)`，body 為檔案原始 bytes |

- 檔名重複會自動改成 `name (1).ext`；傳輸中先寫 `.part`，完成才改名
