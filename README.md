# android-to-mac

在同一個 Wi-Fi 下，把 Android 上的照片、影片、文件傳到 Mac。不經過雲端。

```
server/   Mac 端接收 server（Node + TypeScript），用 mDNS 廣播自己
web/      React 上傳頁（瀏覽器備用 / 測試用）
app/      React Native Android App，接「分享」選單（開發中）
```

## 使用方式（Mac 上）

```bash
npm install
npm run build
npm start
```

終端機會印出網址和 QR code，手機掃碼即可從瀏覽器上傳。檔案存到 `~/Downloads/FromAndroid`。

可用環境變數：`PORT`（預設 8765）、`SAVE_DIR`、`DEVICE_NAME`。

開發時：`npm run dev:server` 搭配 `npm run dev:web`（Vite 會把 `/api` 轉給 server）。

## 傳輸協定

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/info` | `{ name, version }`，App 用來確認是不是我們的 server |
| POST | `/api/upload` | Header `X-File-Name: encodeURIComponent(檔名)`，body 為檔案原始 bytes |

- mDNS 服務類型：`_android2mac._tcp`
- 檔名重複會自動改成 `name (1).ext`；傳輸中先寫 `.part`，完成才改名
