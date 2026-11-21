package org.meshchat.lab

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.meshchat.lab.security.AndroidKeyProtector
import org.meshchat.lab.security.HardwareLabController

/** LAB only: ephemeral hardware test, no chats, personal data, persistence or network. */
class MainActivity : ComponentActivity() {
    private var resumed by mutableStateOf(false)
    private var status by mutableStateOf("Тест не запускался. Личные данные не вводите.")
    private lateinit var lab: HardwareLabController
    private var receiverRegistered = false
    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF && ::lab.isInitialized) lab.cancel()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setHideOverlayWindows(true)
        super.onCreate(savedInstanceState)
        lab = HardwareLabController(this, { resumed }, { status = it })
        window.decorView.filterTouchesWhenObscured = true
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        setContent {
            var confirmTee by remember { mutableStateOf(false) }
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(24.dp)) {
                        Text("MeshChat LAB", style = MaterialTheme.typography.headlineLarge)
                        Text("Это НЕ защищённый мессенджер. Сети, сообщений и хранилища нет.")
                        Text("Аппаратный тест", style = MaterialTheme.typography.titleLarge)
                        Text("По нажатию создаётся временный тестовый hardware key. Два системных биометрических подтверждения проверяют wrap/unwrap случайных 32 байт; результат сразу очищается, alias удаляется по завершении/отмене. При аварийном завершении alias может остаться до удаления LAB-приложения.")
                        Button(enabled = resumed, onClick = {
                            lab.start(AndroidKeyProtector.EnrollmentPolicy.STRONGBOX_REQUIRED)
                        }) { Text("Создать временный ключ и проверить StrongBox") }
                        TextButton(enabled = resumed, onClick = { confirmTee = true }) {
                            Text("Отдельно разрешить тест TEE")
                        }
                        TextButton(onClick = { lab.cancel() }) { Text("Остановить тест") }
                        Text(status)
                        Text("Ограничения", style = MaterialTheme.typography.titleLarge)
                        Text("Нужна настроенная сильная биометрия. PIN fallback не реализован. Отсутствие StrongBox не вызывает переход на TEE автоматически.")
                        Text("Блокировка экрана или уход из приложения отменяет тест. FLAG_SECURE не защищает от root, камеры или принуждения.")
                        Text("Rust-политики и парсер пока не подключены через UniFFI. E2EE, база, доставка, TUF и production release ещё отсутствуют.")
                    }
                }
                if (confirmTee) {
                    AlertDialog(
                        onDismissRequest = { confirmTee = false },
                        title = { Text("Явно разрешить TEE для этого теста?") },
                        text = { Text("TEE не равен отдельному StrongBox. Только аппаратный ключ; software fallback запрещён. Настройка не сохраняется.") },
                        confirmButton = {
                            TextButton(onClick = {
                                confirmTee = false
                                lab.start(AndroidKeyProtector.EnrollmentPolicy.TEE_EXPLICITLY_ALLOWED)
                            }) { Text("Разрешить один тест TEE") }
                        },
                        dismissButton = {
                            TextButton(onClick = { confirmTee = false }) { Text("Отмена") }
                        },
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenOff, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(screenOff, filter)
        }
        receiverRegistered = true
    }

    override fun onResume() {
        super.onResume()
        resumed = true
    }

    override fun onPause() {
        resumed = false
        if (::lab.isInitialized) lab.cancel()
        super.onPause()
    }

    override fun onStop() {
        if (receiverRegistered) {
            unregisterReceiver(screenOff)
            receiverRegistered = false
        }
        super.onStop()
    }

    override fun onDestroy() {
        if (::lab.isInitialized) lab.close()
        super.onDestroy()
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val obscured = MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED
        if (event.flags and obscured != 0) return false
        return super.dispatchTouchEvent(event)
    }
}
