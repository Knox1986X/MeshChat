// Фоновый сервис удержания защищённого канала MeshChat для доставки E2EE-сообщений и звонков в шторку уведомлений.
// Не хранит ключей и не передаёт аналитику: только удерживает процесс и локальный WebSocket от выгрузки системой (Doze/HyperOS).

package org.meshchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;

public final class MeshKeepAliveService extends Service {
    public static final String CHANNEL_BG_ID = "meshchat_bg_keepalive";
    public static final int FG_NOTIFICATION_ID = 1001;

    private PowerManager.WakeLock partialWakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureBackgroundChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            ensureBackgroundChannel();
            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                    this,
                    901,
                    openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Notification notif = new Notification.Builder(this, CHANNEL_BG_ID)
                    .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                    .setContentTitle("MeshChat · Защищённый канал активен")
                    .setContentText("Ожидание входящих E2EE-сообщений и звонков")
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .setCategory(Notification.CATEGORY_SERVICE)
                    .setVisibility(Notification.VISIBILITY_SECRET)
                    .build();

            startForeground(FG_NOTIFICATION_ID, notif);
            acquireLightWakeLock();
        } catch (Throwable ignored) {
        }
        return START_STICKY;
    }

    private void acquireLightWakeLock() {
        try {
            if (partialWakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    partialWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MeshChat:E2eeKeepAlive");
                    partialWakeLock.setReferenceCounted(false);
                }
            }
            if (partialWakeLock != null && !partialWakeLock.isHeld()) {
                partialWakeLock.acquire(15 * 60 * 1000L);
            }
        } catch (Throwable ignored) {
        }
    }

    private void ensureBackgroundChannel() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_BG_ID,
                    "Фоновая доставка в шторку",
                    NotificationManager.IMPORTANCE_MIN
            );
            ch.setDescription("Тихий фоновый канал для приёма звонков и сообщений при свёрнутом приложении");
            ch.setShowBadge(false);
            ch.enableVibration(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (partialWakeLock != null && partialWakeLock.isHeld()) {
                partialWakeLock.release();
            }
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
