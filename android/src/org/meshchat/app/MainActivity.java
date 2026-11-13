// Главный экран Android-приложения MeshChat v1.5.
// Запускает изолированный SOCKS5-мост (127.0.0.1:27700) и собственный локальный узел (127.0.0.1:27701),
// сбрасывает HTTP-кеш ассетов при обновлении версии (сохраняя IndexedDB и AndroidKeyStore Vault),
// управляет защитой от скриншотов (по умолчанию ВЫКЛ — скриншоты разрешены, переключается в Настройках)
// и делегирует системную кнопку/жест «Назад» в SPA-навигацию интерфейса.

package org.meshchat.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_RECORD_AUDIO = 1002;
    public static final int REQ_INSTALL_UNKNOWN_APPS = 1003;
    private static final String LEGACY_PACKAGE = "org.meshchat.app";
    private static final String META_PREFS = "meshchat_meta";
    private static final String KEY_SCREENSHOT_PROTECTION = "screenshot_protection";

    private WebView webView;
    private MeshSocksBridge socksBridge;
    private MeshLocalNode localNode;
    private MeshUpdater updater;
    private MeshNativeVault nativeVault;
    private ValueCallback<Uri[]> fileUploadCallback;
    private PermissionRequest pendingWebRtcPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(META_PREFS, MODE_PRIVATE);
        // Скриншоты по умолчанию разрешены (false); пользователь может включить FLAG_SECURE в Настройках
        boolean secureScreen = prefs.getBoolean(KEY_SCREENSHOT_PROTECTION, false);

        Window window = getWindow();
        if (window != null) {
            applyWindowSecureFlag(secureScreen);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#0b0d14"));
            window.setNavigationBarColor(Color.parseColor("#0b0d14"));
        }

        nativeVault = new MeshNativeVault(this);

        socksBridge = new MeshSocksBridge();
        socksBridge.start();

        localNode = new MeshLocalNode(this);
        localNode.startLoopback();
        updater = new MeshUpdater(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0d14"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0d14"));
        configureWebView(webView);

        // При обновлении версии очищаем ТОЛЬКО HTTP-кеш файлов (IndexedDB и AndroidKeyStore не затрагиваются)
        int currentVerCode = getCurrentVersionCode();
        int prevVerCode = prefs.getInt("last_ver_code", -1);
        if (prevVerCode != currentVerCode) {
            webView.clearCache(true);
            prefs.edit().putInt("last_ver_code", currentVerCode).apply();
        }

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        int port = localNode.getBoundPort();
        webView.loadUrl("http://127.0.0.1:" + port + "/?v=" + currentVerCode);
    }

    private void applyWindowSecureFlag(boolean enabled) {
        Window window = getWindow();
        if (window == null) return;
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    private boolean isScreenshotProtectionActive() {
        return getSharedPreferences(META_PREFS, MODE_PRIVATE).getBoolean(KEY_SCREENSHOT_PROTECTION, false);
    }

    private int getCurrentVersionCode() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionCode;
        } catch (Exception e) {
            return 6;
        }
    }

    private boolean isLegacyPackageInstalled() {
        if (LEGACY_PACKAGE.equals(getPackageName())) return false;
        try {
            getPackageManager().getPackageInfo(LEGACY_PACKAGE, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void configureWebView(WebView wv) {
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        wv.addJavascriptInterface(new AndroidJsBridge(), "MeshChatAndroid");

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "127.0.0.1".equals(uri.getHost())) {
                    return false;
                }
                if (uri != null && ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;
            }
        });

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(Intent.createChooser(intent, "Выберите файл"), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            } else {
                                pendingWebRtcPermission = request;
                                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
                            }
                            return;
                        }
                    }
                    request.deny();
                });
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        } else if (requestCode == REQ_INSTALL_UNKNOWN_APPS && updater != null) {
            updater.triggerPackageInstallerIfPermitted();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO && pendingWebRtcPermission != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingWebRtcPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pendingWebRtcPermission.deny();
            }
            pendingWebRtcPermission = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('meshchat:resume'));", null);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                    "(window.__meshChatHandleBack && window.__meshChatHandleBack()) ? '1' : '0'",
                    value -> {
                        if ("\"1\"".equals(value) || "1".equals(value)) {
                            return;
                        }
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            MainActivity.super.onBackPressed();
                        }
                    }
            );
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        if (localNode != null) localNode.stopAll();
        if (socksBridge != null) socksBridge.stop();
        super.onDestroy();
    }

    /** Нативный мост управления узлами, автообновлением, FLAG_SECURE и AndroidKeyStore */
    public final class AndroidJsBridge {
        @JavascriptInterface
        public String getAppInfoJson() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                JSONObject o = new JSONObject();
                o.put("packageName", getPackageName());
                o.put("versionName", pi.versionName);
                o.put("versionCode", pi.versionCode);
                o.put("localPort", localNode != null ? localNode.getBoundPort() : MeshLocalNode.LOCAL_PORT);
                o.put("bridgePort", socksBridge != null ? socksBridge.getBoundPort() : MeshSocksBridge.BRIDGE_PORT);
                o.put("legacyInstalled", isLegacyPackageInstalled());
                o.put("screenshotProtection", isScreenshotProtectionActive());
                return o.toString();
            } catch (Exception e) {
                return "{\"packageName\":\"io.meshchat.app\",\"legacyInstalled\":false,\"screenshotProtection\":false}";
            }
        }

        @JavascriptInterface
        public boolean isScreenshotProtectionEnabled() {
            return isScreenshotProtectionActive();
        }

        @JavascriptInterface
        public boolean setScreenshotProtection(boolean enabled) {
            getSharedPreferences(META_PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_SCREENSHOT_PROTECTION, enabled)
                    .apply();
            runOnUiThread(() -> applyWindowSecureFlag(enabled));
            return enabled;
        }

        @JavascriptInterface
        public void uninstallLegacyPackage() {
            if (!isLegacyPackageInstalled()) return;
            runOnUiThread(() -> {
                try {
                    Intent del = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + LEGACY_PACKAGE));
                    del.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(del);
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void writeNativeVault(String key, String value) {
            if (nativeVault != null) nativeVault.write(key, value);
        }

        @JavascriptInterface
        public String readNativeVault(String key) {
            return nativeVault != null ? nativeVault.read(key) : null;
        }

        @JavascriptInterface
        public void deleteNativeVault(String key) {
            if (nativeVault != null) nativeVault.delete(key);
        }

        @JavascriptInterface
        public void clearNativeVault() {
            if (nativeVault != null) nativeVault.clearAll();
        }

        @JavascriptInterface
        public void setUpstreamServer(String serverUrl) {
            if (localNode != null) {
                localNode.setUpstreamServer(serverUrl);
            }
        }

        @JavascriptInterface
        public String toggleLanMesh(boolean enable) {
            boolean running = localNode != null && localNode.setLanMeshEnabled(enable);
            return buildStatusJson(running);
        }

        @JavascriptInterface
        public String getLanStatusJson() {
            boolean running = localNode != null && localNode.isLanMeshRunning();
            return buildStatusJson(running);
        }

        @JavascriptInterface
        public void downloadAndInstallUpdate(String apkUrl, String expectedSha256) {
            if (updater == null) return;
            updater.downloadAndInstall(apkUrl, expectedSha256, (pct, statusText, errText) -> {
                runOnUiThread(() -> {
                    if (webView == null) return;
                    String js = "window.__onMeshChatUpdateProgress && window.__onMeshChatUpdateProgress("
                            + pct + ","
                            + JSONObject.quote(statusText != null ? statusText : "") + ","
                            + (errText != null ? JSONObject.quote(errText) : "null") + ");";
                    webView.evaluateJavascript(js, null);
                });
            });
        }

        private String buildStatusJson(boolean running) {
            try {
                JSONObject o = new JSONObject();
                o.put("running", running);
                o.put("url", running && localNode != null ? localNode.detectLanUrl() : "");
                return o.toString();
            } catch (Exception e) {
                return "{\"running\":false,\"url\":\"\"}";
            }
        }
    }
}
