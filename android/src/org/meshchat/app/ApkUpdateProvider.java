// Безопасный локальный ContentProvider для передачи проверенного пакета обновления
// системному установщику пакетов Android (без FileUriExposedException и внешних AAR-зависимостей).

package org.meshchat.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

public final class ApkUpdateProvider extends ContentProvider {
    public static final String AUTHORITY = "org.meshchat.app.apkprovider";

    public static File getUpdatesDir(android.content.Context ctx) {
        File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    public static Uri buildUriForFile(String fileName) {
        return Uri.parse("content://" + AUTHORITY + "/" + fileName);
    }

    private File resolveSafeFile(Uri uri) throws FileNotFoundException {
        if (uri == null || getContext() == null) throw new FileNotFoundException("Invalid URI");
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("..") || name.contains("/") || !name.endsWith(".apk")) {
            throw new FileNotFoundException("Disallowed update path");
        }
        File f = new File(getUpdatesDir(getContext()), name);
        if (!f.exists()) throw new FileNotFoundException("Update file not found");
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = resolveSafeFile(uri);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File file = resolveSafeFile(uri);
            String[] cols = projection != null
                    ? projection
                    : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor cursor = new MatrixCursor(cols, 1);
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) {
                    row[i] = file.getName();
                } else if (OpenableColumns.SIZE.equals(cols[i])) {
                    row[i] = file.length();
                }
            }
            cursor.addRow(row);
            return cursor;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
