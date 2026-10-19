# android-to-mac

在同一個 Wi-Fi 下，把 Android 上的照片、影片、文件傳到 Mac。不經過雲端。

```
server/   Mac 端接收 server（Node + TypeScript），用 mDNS 廣播自己
web/      React 上傳頁（瀏覽器備用 / 測試用）
app/      Expo（React Native）Android App，接「分享」選單
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

## Android App（app/）

Expo SDK 57 + `expo-share-intent`。因為用到原生模組，**不能用 Expo Go**，要自己編譯。

需要：Mac 上裝 [Android Studio](https://developer.android.com/studio)（附 Android SDK 與 JDK），手機開啟「開發人員選項 → USB 偵錯」並用 USB 接上 Mac。

```bash
cd app
npm install
npx expo run:android                     # 開發版：改程式碼即時更新，需要 Mac 上的 Metro 一直開著
npx expo run:android --variant release   # 正式版：裝好之後不用接 Mac 也能用
```

`android/` 由 `expo prebuild` 自動產生，不進版控；原生設定都寫在 `app.json`。

使用方式：在相簿或檔案 App 選好檔案 →「分享」→「傳到 Mac」。第一次會請你選 Mac（mDNS 自動找，或手動輸入 IP），之後會記住，分享後直接開始傳。

## 傳輸協定

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/info` | `{ name, version }`，App 用來確認是不是我們的 server |
| POST | `/api/upload` | Header `X-File-Name: encodeURIComponent(檔名)`，body 為檔案原始 bytes |

- mDNS 服務類型：`_android2mac._tcp`
- 檔名重複會自動改成 `name (1).ext`；傳輸中先寫 `.part`，完成才改名
