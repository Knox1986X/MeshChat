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
import androidx.activity.result.contract.ActivityResultContracts
import org.meshchat.lab.diagnostics.DiagnosticLog
import org.meshchat.lab.diagnostics.DiagnosticEvent
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
    private val diagnostics = DiagnosticLog()
    private var pendingExport: String? = null
    private var exportStatus by mutableStateOf("")
    private val saveDiagnostics = registerForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        val snapshot = pendingExport
        pendingExport = null
        if (uri != null && snapshot != null) {
            exportStatus = try {
                checkNotNull(contentResolver.openOutputStream(uri, "wt")).bufferedWriter(Charsets.UTF_8).use { it.write(snapshot) }
                "Отчёт сохранён по вашему выбору. Пришлите только этот файл, не системный bugreport."
            } catch (_: Exception) {
                "Не удалось сохранить отчёт. Содержимое ошибки и URI не записываются."
            }
        } else exportStatus = "Экспорт отменён."
    }
    private fun diagnosticSnapshot(): String =
        "source=${BuildConfig.SOURCE_REVISION} version=${BuildConfig.VERSION_NAME} androidApi=${Build.VERSION.SDK_INT}\n" + diagnostics.snapshot()

    private var receiverRegistered = false
    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF && ::lab.isInitialized) {
                diagnostics.record(DiagnosticEvent.SCREEN_OFF)
                lab.cancel()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setHideOverlayWindows(true)
        super.onCreate(savedInstanceState)
        diagnostics.record(DiagnosticEvent.APP_OPENED)
        lab = HardwareLabController(this, { resumed }, { status = it }, diagnostics::record)
        window.decorView.filterTouchesWhenObscured = true
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        setContent {
            var confirmTee by remember { mutableStateOf(false) }
            var preview by remember { mutableStateOf<String?>(null) }
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(24.dp)) {
                        Text("MeshChat LAB", style = MaterialTheme.typography.headlineLarge)
                        Text("Тестовая сборка с диагностикой. Это НЕ защищённый мессенджер: сети, переписки и постоянного пользовательского хранилища нет.")
                        Text("Аппаратный тест", style = MaterialTheme.typography.titleLarge)
                        Text("По нажатию создаётся временный тестовый hardware key. Два системных биометрических подтверждения проверяют wrap/unwrap случайных 32 байт; ключ передаётся в Rust SQLCipher через UniFFI для проверки create/lock/reopen, затем очищается; временные БД и alias удаляются по завершении/отмене. При аварийном завершении alias может остаться до удаления LAB-приложения.")
                        Button(enabled = resumed, onClick = {
                            lab.start(AndroidKeyProtector.EnrollmentPolicy.STRONGBOX_REQUIRED)
                        }) { Text("Создать временный ключ и проверить StrongBox") }
                        TextButton(enabled = resumed, onClick = { confirmTee = true }) {
                            Text("Отдельно разрешить тест TEE")
                        }
                        TextButton(onClick = { lab.cancel() }) { Text("Остановить тест") }
                        Text(status)
                        Text("Диагностика", style = MaterialTheme.typography.titleLarge)
                        Text("Только коды этапов и ошибок, версия сборки и Android API. Без ключей, сообщений и системного logcat. До 256 событий в RAM; после завершения процесса журнал пропадёт. Автоотправки нет.")
                        TextButton(onClick = { preview = diagnosticSnapshot() }) { Text("Просмотреть и экспортировать отчёт") }
                        TextButton(onClick = {
                            diagnostics.clear()
                            preview = null
                            pendingExport = null
                            exportStatus = "Журнал очищен. Ранее экспортированные файлы удалите отдельно."
                        }) { Text("Очистить журнал") }
                        Text(exportStatus)
                        Text("Ограничения", style = MaterialTheme.typography.titleLarge)
                        Text("Нужна настроенная сильная биометрия. PIN fallback не реализован. Отсутствие StrongBox не вызывает переход на TEE автоматически.")
                        Text("Блокировка экрана или уход из приложения отменяет тест. FLAG_SECURE не защищает от root, камеры или принуждения.")
                        Text("Rust SQLCipher lifecycle подключён через UniFFI только к этому LAB-тесту. E2EE, переписка, доставка, TUF и production release ещё отсутствуют.")
                    }
                }
                preview?.let { frozen ->
                    AlertDialog(
                        onDismissRequest = { preview = null },
                        title = { Text("Проверьте отчёт перед сохранением") },
                        text = {
                            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                                Text("Файл будет передан выбранному вами приложению/хранилищу. Облачный провайдер может его загрузить. Отправляйте мне только этот отчёт, не полный bugreport. После выхода в выбор файла текущий тест отменится.\n\n" + frozen)
                            }
                        },
                        confirmButton = {
                            TextButton(onClick = {
                                // Cancel and include that event before leaving Activity.
                                lab.cancel()
                                pendingExport = diagnosticSnapshot()
                                preview = null
                                saveDiagnostics.launch("MeshChat-diagnostics.txt")
                            }) { Text("Сохранить .txt…") }
                        },
                        dismissButton = { TextButton(onClick = { preview = null }) { Text("Закрыть") } },
                    )
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
        diagnostics.record(DiagnosticEvent.PAUSED)
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
