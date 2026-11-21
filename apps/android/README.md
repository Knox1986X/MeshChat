# Android LAB bootstrap — NOT a secure messenger

Нативная Kotlin/Compose оболочка без INTERNET permission, сообщений, ключей и хранилища.
Это отдельный `org.meshchat.lab`, не production identity. Нет экспорта IPC и доверия
приложениям с debug certificate. Release variant выключен. Debug APK, если собран,
подписывается локальным **тестовым** Android debug key и непригоден для production.
Ключ разработчика сюда не передавать, не создавать release keystore в CI.

## Сборка на подготовленной машине

Нужны JDK17, Android SDK platform35/build-tools для AGP8.9.2 и Gradle8.11.1.
Версии плагинов зафиксированы в build.gradle.kts. Gradle wrapper и полная dependency
verification/locking пока не подготовлены; это блокер воспроизводимого release,
а не обещание готового supply-chain pipeline.

```
cd apps/android
gradle --version              # проверить 8.11.1, JDK17
gradle :app:assembleDebug
```
Результат: `app/build/outputs/apk/debug/app-debug.apk`. Не включать APK в Git.
Установку и поведение FLAG_SECURE/backup/overlay проверить на реальном Android;
Python static tests этого НЕ подтверждают. В среде текущей сессии нет JDK/SDK/Gradle,
а Google Maven недоступен по сетевой политике, поэтому сборка не выполнялась.

## Добавлен AndroidKeyProtector (пока не интегрирован)

`security/AndroidKeyProtector.kt` — hardware-only AndroidKeyStore wrapping adapter.
`STRONGBOX_REQUIRED` не переключается на TEE автоматически; software keys запрещены.
Per-use biometric CryptoObject требует настоящего OS prompt; его UI/permission и
lock orchestration ещё не реализованы. Исходники не компилировались и hardware
свойства не проверялись. Подробный контракт: `../../docs/KEY_PROTECTOR.md`.

Пять подготовленных instrumented operation/format tests используют public synthetic
software JCA keys и НЕ проверяют hardware/biometric security:
```
gradle :app:connectedDebugAndroidTest
```

## Следующий этап
Скомпилировать и проверить adapter, реализовать BiometricPrompt/lifecycle/lock hooks
на реальных StrongBox/TEE устройствах; после protocol freeze — настоящее Zeroize
ядро/SQLCipher, UniFFI Kotlin binding. До этого нельзя добавлять поле ввода личных
сообщений или имитировать статус E2EE.
